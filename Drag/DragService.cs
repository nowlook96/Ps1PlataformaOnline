using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace PlataformaOnline.Drag;

public sealed record PlayerDto(
    string Id, string Name, long Respect, long TotalRespect, int Races, int Wins, int Losses,
    int PerfectShifts, int? BestEtMs, int? BestReactionMs, double TopSpeedKmh, string CarId,
    IReadOnlyList<string> OwnedCars, IReadOnlyList<string> OwnedParts,
    IReadOnlyDictionary<string, List<string>> InstalledParts, int Rank);

public sealed record LeaderboardEntry(int Rank, string Name, long TotalRespect, int Wins, int Races, int? BestEtMs, string CarId, bool IsYou);

public sealed record Leaderboard(IReadOnlyList<LeaderboardEntry> Top, int PlayerRank, int TotalPlayers);

public sealed record BotPlanDto(double LaunchRpm, int ReactionSteps, double[] ShiftRpm);

public sealed record RaceStartDto(
    string RaceId, string OpponentId, string OpponentCarId, string PlayerCarId, IReadOnlyList<string> PlayerParts,
    int GreenStep, int StepsPerSecond, double DistanceM, int MaxSteps, BotPlanDto OpponentPlan);

public sealed record RunSummary(bool Finished, bool JumpStart, int? ReactionMs, int? EtMs, int? TotalMs, double TopSpeedKmh, int Shifts, int PerfectShifts);

public sealed record RespectLine(string Label, int Amount);

public sealed record RaceResultDto(
    bool Won, RunSummary Player, RunSummary Opponent, int RespectGained, IReadOnlyList<RespectLine> RespectLines,
    bool NewBestEt, PlayerDto Profile, Leaderboard Leaderboard);

public sealed class DragException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>
/// Regras do jogo no servidor: cadastro de pilotos, corridas e respeito.
/// O cliente só manda as entradas (acelerar/trocar marcha); o tempo e o vencedor são recalculados aqui.
/// </summary>
public sealed partial class DragService(DragCatalogProvider catalogProvider, DragStore store)
{
    private const int MaxPlayers = 50_000;
    private const int MaxEvents = 3_000;
    private static readonly TimeSpan RaceExpiry = TimeSpan.FromMinutes(5);

    private readonly ConcurrentDictionary<string, PendingRace> races = new();

    private DragCatalog Catalog => catalogProvider.Catalog;

    private sealed record PendingRace(
        string PlayerId, OpponentDef Opponent, CarPhysics PlayerCar, CarPhysics OpponentCar,
        DragPhysics.BotPlan Plan, int GreenStep, DateTime StartedUtc);

    [GeneratedRegex(@"^[\p{L}\p{N}][\p{L}\p{N} _\-\.]{1,14}[\p{L}\p{N}_\.]$")]
    private static partial Regex NameRegex();

    // ---------- Pilotos ----------

    public static string NormalizeName(string? raw)
    {
        var name = (raw ?? "").Normalize(NormalizationForm.FormC).Trim();
        name = Regex.Replace(name, @"\s+", " ");
        if (!NameRegex().IsMatch(name))
            throw new DragException(400, "Use de 3 a 16 caracteres: letras, números, espaço, _ - .");
        return name;
    }

    public async Task<(PlayerDto Player, string Token)> CreatePlayerAsync(string? rawName)
    {
        var name = NormalizeName(rawName);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var dto = await store.WriteAsync(players =>
        {
            if (players.Count >= MaxPlayers)
                throw new DragException(503, "Limite de pilotos atingido.");
            if (players.Any(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)))
                throw new DragException(409, "Esse nome já está em uso. Escolha outro.");

            var record = new PlayerRecord
            {
                Id = Guid.NewGuid().ToString("N"),
                Name = name,
                TokenHash = HashToken(token),
                CarId = Catalog.StarterCar,
                OwnedCars = [Catalog.StarterCar],
                CreatedUtc = DateTime.UtcNow
            };
            players.Add(record);
            return (ToDto(record, players), true);
        });
        return (dto, token);
    }

    public Task<PlayerDto> GetPlayerAsync(string? token) =>
        store.ReadAsync(players => ToDto(Authenticate(players, token), players));

    public Task<Leaderboard> GetLeaderboardAsync(int top, string? token) =>
        store.ReadAsync(players =>
        {
            PlayerRecord? me = null;
            if (!string.IsNullOrEmpty(token))
            {
                try { me = Authenticate(players, token); } catch (DragException) { }
            }
            return BuildLeaderboard(players, Math.Clamp(top, 1, 50), me);
        });

    // ---------- Corridas ----------

    public async Task<RaceStartDto> StartRaceAsync(string? token, string? opponentId)
    {
        var opponent = Catalog.FindOpponent(opponentId ?? "");
        if (opponent is null || !opponent.Available || opponent.ComingSoon)
            throw new DragException(400, "Oponente indisponível.");
        var opponentCarDef = Catalog.FindCar(opponent.Car) ?? throw new DragException(500, "Carro do oponente não existe.");

        var player = await store.ReadAsync(players =>
        {
            var p = Authenticate(players, token);
            return (Id: p.Id, CarId: p.CarId, Parts: p.InstalledParts.GetValueOrDefault(p.CarId)?.ToList() ?? []);
        });
        var playerCarDef = Catalog.FindCar(player.CarId) ?? throw new DragException(500, "Carro do piloto não existe.");
        var parts = player.Parts.Select(Catalog.FindPart).OfType<PartDef>().ToList();

        var track = Catalog.Track;
        var hz = track.StepsPerSecond;
        var rng = Random.Shared;
        var greenStep = (int)Math.Round((track.GreenMinS + rng.NextDouble() * (track.GreenMaxS - track.GreenMinS)) * hz);

        var oppCar = DragPhysics.DeriveCar(opponentCarDef.Physics, []);
        var reaction = opponent.ReactionMinS + rng.NextDouble() * (opponent.ReactionMaxS - opponent.ReactionMinS);
        // Erro de troca: tende a trocar um pouco cedo (como um piloto humano), às vezes passa do ponto.
        var shiftRpm = oppCar.Gears
            .Select(_ => Math.Round(Math.Min(oppCar.LimiterRpm, oppCar.ShiftRpm + (rng.NextDouble() * 1.6 - 1) * opponent.ShiftErrorRpm)))
            .ToArray();
        var plan = new DragPhysics.BotPlan(opponent.LaunchRpm, (int)Math.Round(reaction * hz), shiftRpm);

        // Uma corrida pendente por piloto; aproveita para limpar as expiradas.
        var now = DateTime.UtcNow;
        foreach (var (id, race) in races)
        {
            if (race.PlayerId == player.Id || now - race.StartedUtc > RaceExpiry) races.TryRemove(id, out _);
        }

        var raceId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        races[raceId] = new PendingRace(player.Id, opponent, DragPhysics.DeriveCar(playerCarDef.Physics, parts), oppCar, plan, greenStep, now);

        return new RaceStartDto(raceId, opponent.Id, opponentCarDef.Id, playerCarDef.Id, player.Parts,
            greenStep, hz, track.DistanceM, MaxSteps,
            new BotPlanDto(plan.LaunchRpm, plan.ReactionSteps, plan.ShiftRpm));
    }

    private int MaxSteps => (int)(Catalog.Track.MaxSeconds * Catalog.Track.StepsPerSecond);

    public async Task<RaceResultDto> FinishRaceAsync(string? token, string raceId, int[][]? events)
    {
        if (!races.TryGetValue(raceId ?? "", out var race))
            throw new DragException(404, "Corrida não encontrada ou expirada.");
        var playerId = await store.ReadAsync(players => Authenticate(players, token).Id);
        if (playerId != race.PlayerId) throw new DragException(403, "Essa corrida é de outro piloto.");

        var validEvents = ValidateEvents(events);
        var track = Catalog.Track;
        var hz = track.StepsPerSecond;

        var me = DragPhysics.Replay(race.PlayerCar, validEvents, race.GreenStep, hz, track.DistanceM, MaxSteps);
        var opp = DragPhysics.SimulateBot(race.OpponentCar, race.Plan, race.GreenStep, hz, track.DistanceM, MaxSteps);

        // A corrida não pode ter terminado antes do tempo real que ela leva (sem acelerar o relógio do navegador).
        var lastStep = me.Finished ? me.FinishTime * hz : validEvents.Count > 0 ? validEvents[^1][0] : 0;
        var elapsed = (DateTime.UtcNow - race.StartedUtc).TotalSeconds;
        if (elapsed + 1.0 < lastStep / hz)
            throw new DragException(400, "Resultado recusado: tempo de corrida inválido.");

        var mine = Summarize(me, race.GreenStep, hz);
        var theirs = Summarize(opp, race.GreenStep, hz);
        var won = me.Finished && !me.Jump && (!opp.Finished || me.FinishTime < opp.FinishTime);

        // Calcula o respeito.
        var rules = Catalog.Respect;
        var lines = new List<RespectLine>();
        if (me.Jump) lines.Add(new("Largada queimada", rules.JumpStart));
        else if (!me.Finished) lines.Add(new("Não terminou", rules.DidNotFinish));
        else
        {
            lines.Add(won ? new($"Vitória contra {race.Opponent.Name}", race.Opponent.RespectWin)
                          : new($"Derrota para {race.Opponent.Name}", race.Opponent.RespectLoss));
            var perfect = Math.Min(me.Perfect, rules.MaxPerfectShiftBonuses);
            if (perfect > 0) lines.Add(new($"Trocas perfeitas ×{perfect}", perfect * rules.PerfectShiftBonus));
            if (mine.ReactionMs is { } r && r <= rules.ReactionBonusMaxS * 1000) lines.Add(new("Reação relâmpago", rules.ReactionBonus));
        }
        var gained = lines.Sum(l => l.Amount);

        // Só um resultado por corrida.
        if (!races.TryRemove(raceId!, out _))
            throw new DragException(409, "Resultado já enviado.");

        var (profile, board, newBest) = await store.WriteAsync(players =>
        {
            var p = Authenticate(players, token);
            if (p.Id != race.PlayerId) throw new DragException(403, "Essa corrida é de outro piloto.");

            p.Races++;
            if (won) p.Wins++; else p.Losses++;
            p.Respect += gained;
            p.TotalRespect += gained;
            p.PerfectShifts += me.Perfect;
            p.LastRaceUtc = DateTime.UtcNow;
            var best = false;
            if (!me.Jump && mine.EtMs is { } et && (p.BestEtMs is null || et < p.BestEtMs))
            {
                p.BestEtMs = et;
                best = true;
            }
            if (!me.Jump && mine.ReactionMs is { } rt && (p.BestReactionMs is null || rt < p.BestReactionMs)) p.BestReactionMs = rt;
            if (mine.TopSpeedKmh > p.TopSpeedKmh) p.TopSpeedKmh = mine.TopSpeedKmh;
            return ((ToDto(p, players), BuildLeaderboard(players, 10, p), best), true);
        });

        return new RaceResultDto(won, mine, theirs, gained, lines, newBest, profile, board);
    }

    private List<int[]> ValidateEvents(int[][]? events)
    {
        if (events is null) return [];
        if (events.Length > MaxEvents) throw new DragException(400, "Entradas demais.");
        var list = new List<int[]>(events.Length);
        var last = 0;
        foreach (var ev in events)
        {
            if (ev is not { Length: 2 } || ev[0] < 0 || ev[0] >= MaxSteps || ev[0] < last || ev[1] is < 0 or > 2)
                throw new DragException(400, "Entradas inválidas.");
            last = ev[0];
            list.Add(ev);
        }
        return list;
    }

    private static RunSummary Summarize(DragPhysics.RunState s, int greenStep, int hz)
    {
        int? Ms(double seconds) => (int)Math.Round(seconds * 1000);
        var launch = s.LaunchStep >= 0 ? (double)s.LaunchStep / hz : (double?)null;
        var green = (double)greenStep / hz;
        return new RunSummary(
            s.Finished, s.Jump,
            launch is { } l ? Ms(l - green) : null,
            s.Finished && launch is { } l2 ? Ms(s.FinishTime - l2) : null,
            s.Finished ? Ms(s.FinishTime - green) : null,
            Math.Round(s.TopSpeed * 3.6, 1), s.Shifts, s.Perfect);
    }

    // ---------- Apoio ----------

    private static PlayerRecord Authenticate(IReadOnlyList<PlayerRecord> players, string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 128)
            throw new DragException(401, "Piloto não identificado.");
        var hash = HashToken(token);
        var bytes = Encoding.ASCII.GetBytes(hash);
        foreach (var p in players)
        {
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(p.TokenHash), bytes)) return p;
        }
        throw new DragException(401, "Piloto não encontrado. Crie um novo piloto.");
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static IOrderedEnumerable<PlayerRecord> Ranked(IEnumerable<PlayerRecord> players) =>
        players.OrderByDescending(p => p.TotalRespect)
               .ThenByDescending(p => p.Wins)
               .ThenBy(p => p.BestEtMs ?? int.MaxValue)
               .ThenBy(p => p.CreatedUtc);

    private static int RankOf(IReadOnlyList<PlayerRecord> players, PlayerRecord me) =>
        Ranked(players).Select((p, i) => (p, i)).First(x => x.p == me).i + 1;

    private static Leaderboard BuildLeaderboard(IReadOnlyList<PlayerRecord> players, int top, PlayerRecord? me)
    {
        var list = Ranked(players).Take(top)
            .Select((p, i) => new LeaderboardEntry(i + 1, p.Name, p.TotalRespect, p.Wins, p.Races, p.BestEtMs, p.CarId, p == me))
            .ToList();
        return new Leaderboard(list, me is null ? 0 : RankOf(players, me), players.Count);
    }

    private static PlayerDto ToDto(PlayerRecord p, IReadOnlyList<PlayerRecord> players) => new(
        p.Id, p.Name, p.Respect, p.TotalRespect, p.Races, p.Wins, p.Losses, p.PerfectShifts,
        p.BestEtMs, p.BestReactionMs, p.TopSpeedKmh, p.CarId, p.OwnedCars, p.OwnedParts, p.InstalledParts,
        RankOf(players, p));
}

