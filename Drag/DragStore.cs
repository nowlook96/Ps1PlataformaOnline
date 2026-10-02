using System.Text.Json;

namespace PlataformaOnline.Drag;

public sealed class PlayerRecord
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>SHA-256 do token de acesso do piloto (o token em si nunca é gravado).</summary>
    public string TokenHash { get; set; } = "";
    /// <summary>Respeito disponível para gastar (loja de carros/peças).</summary>
    public long Respect { get; set; }
    /// <summary>Respeito acumulado na carreira; é o que conta no ranking mundial.</summary>
    public long TotalRespect { get; set; }
    public int Races { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public int PerfectShifts { get; set; }
    public int? BestEtMs { get; set; }
    public int? BestReactionMs { get; set; }
    public double TopSpeedKmh { get; set; }
    public string CarId { get; set; } = "";
    public List<string> OwnedCars { get; set; } = [];
    public List<string> OwnedParts { get; set; } = [];
    /// <summary>Peças instaladas por carro (id do carro → ids das peças).</summary>
    public Dictionary<string, List<string>> InstalledParts { get; set; } = [];
    public DateTime CreatedUtc { get; set; }
    public DateTime? LastRaceUtc { get; set; }
}

/// <summary>
/// Persistência dos pilotos em JSON fora do wwwroot (pasta Dados/, nunca servida).
/// Gravação atômica: escreve num .tmp e troca pelo arquivo final mantendo um .bak da versão anterior.
/// Todo acesso passa por um único semáforo, então leituras e gravações nunca se cruzam.
/// </summary>
public sealed class DragStore
{
    private const int CurrentVersion = 1;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string path;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly ILogger<DragStore> log;
    private readonly List<PlayerRecord> players;

    private sealed class FileModel
    {
        public int Version { get; set; }
        public List<PlayerRecord> Players { get; set; } = [];
    }

    public DragStore(IConfiguration config, IWebHostEnvironment env, ILogger<DragStore> log)
    {
        this.log = log;
        var folder = config["DragDataFolder"] ?? "Dados";
        if (!Path.IsPathRooted(folder)) folder = Path.Combine(env.ContentRootPath, folder);
        Directory.CreateDirectory(folder);
        path = Path.Combine(folder, "arrancada-pilotos.json");
        players = Load();
    }

    private List<PlayerRecord> Load()
    {
        foreach (var file in new[] { path, path + ".bak" })
        {
            if (!File.Exists(file)) continue;
            try
            {
                var model = JsonSerializer.Deserialize<FileModel>(File.ReadAllBytes(file), Json);
                if (model is not null)
                {
                    if (file != path) log.LogWarning("Pilotos carregados do backup {File}.", file);
                    return model.Players;
                }
            }
            catch (JsonException ex)
            {
                log.LogError(ex, "Arquivo de pilotos corrompido: {File}", file);
            }
        }
        return [];
    }

    /// <summary>Executa uma leitura com o semáforo (sem gravar).</summary>
    public async Task<T> ReadAsync<T>(Func<IReadOnlyList<PlayerRecord>, T> read)
    {
        await gate.WaitAsync();
        try { return read(players); }
        finally { gate.Release(); }
    }

    /// <summary>Executa uma alteração e grava o arquivo se ela retornar <c>changed = true</c>.</summary>
    public async Task<T> WriteAsync<T>(Func<List<PlayerRecord>, (T Result, bool Changed)> write)
    {
        await gate.WaitAsync();
        try
        {
            var (result, changed) = write(players);
            if (changed) await SaveAsync();
            return result;
        }
        finally { gate.Release(); }
    }

    private async Task SaveAsync()
    {
        var tmp = path + ".tmp";
        await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            await JsonSerializer.SerializeAsync(fs, new FileModel { Version = CurrentVersion, Players = players }, Json);
        }
        if (File.Exists(path)) File.Replace(tmp, path, path + ".bak", ignoreMetadataErrors: true);
        else File.Move(tmp, path);
    }
}
