using System.Text.Json;

namespace PlataformaOnline.Drag;

// Catálogo do jogo de arrancada (Drag/catalog.json). O mesmo arquivo é entregue ao navegador,
// então carros, peças e oponentes novos entram só editando o JSON (o modelo 3D é escolhido pelo campo "model").

public sealed class DragCatalog
{
    public int Version { get; set; }
    public TrackRules Track { get; set; } = new();
    public string StarterCar { get; set; } = "";
    public RespectRules Respect { get; set; } = new();
    public List<CarDef> Cars { get; set; } = [];
    public List<PartDef> Parts { get; set; } = [];
    public List<OpponentDef> Opponents { get; set; } = [];

    public CarDef? FindCar(string id) => Cars.FirstOrDefault(c => c.Id == id);
    public PartDef? FindPart(string id) => Parts.FirstOrDefault(p => p.Id == id);
    public OpponentDef? FindOpponent(string id) => Opponents.FirstOrDefault(o => o.Id == id);
}

public sealed class TrackRules
{
    public double DistanceM { get; set; } = 402.336;
    public int StepsPerSecond { get; set; } = 240;
    public double MaxSeconds { get; set; } = 40;
    public double GreenMinS { get; set; } = 3;
    public double GreenMaxS { get; set; } = 4.5;
}

public sealed class RespectRules
{
    public int PerfectShiftBonus { get; set; }
    public int MaxPerfectShiftBonuses { get; set; }
    public int ReactionBonus { get; set; }
    public double ReactionBonusMaxS { get; set; }
    public int JumpStart { get; set; }
    public int DidNotFinish { get; set; }
}

public sealed class CarDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Model { get; set; } = "";
    public int Price { get; set; }
    public bool Available { get; set; }
    public bool ComingSoon { get; set; }
    public CarPhysics Physics { get; set; } = new();
}

public sealed class CarPhysics
{
    public double MassKg { get; set; }
    public double CdA { get; set; }
    public double Crr { get; set; }
    public double TireRadiusM { get; set; }
    public double[] Gears { get; set; } = [];
    public double FinalDrive { get; set; }
    public double Efficiency { get; set; }
    public double IdleRpm { get; set; }
    public double ShiftRpm { get; set; }
    public double LimiterRpm { get; set; }
    public double ShiftTimeS { get; set; }
    public double Grip { get; set; }
    public double DriveWeight { get; set; }
    public double[][] Torque { get; set; } = [];

    public CarPhysics Clone() => new()
    {
        MassKg = MassKg, CdA = CdA, Crr = Crr, TireRadiusM = TireRadiusM, Gears = (double[])Gears.Clone(),
        FinalDrive = FinalDrive, Efficiency = Efficiency, IdleRpm = IdleRpm, ShiftRpm = ShiftRpm,
        LimiterRpm = LimiterRpm, ShiftTimeS = ShiftTimeS, Grip = Grip, DriveWeight = DriveWeight,
        Torque = Torque.Select(p => (double[])p.Clone()).ToArray()
    };
}

public sealed class PartDef
{
    public string Id { get; set; } = "";
    public string Category { get; set; } = "";
    public string Name { get; set; } = "";
    public int Price { get; set; }
    public bool ComingSoon { get; set; }
    public PartEffects Effects { get; set; } = new();
}

public sealed class PartEffects
{
    public double? TorqueMult { get; set; }
    public double? MassKg { get; set; }
    public double? GripMult { get; set; }
    public double? ShiftTimeMult { get; set; }
    public double? CdAMult { get; set; }
}

public sealed class OpponentDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Car { get; set; } = "";
    public double ReactionMinS { get; set; }
    public double ReactionMaxS { get; set; }
    public double ShiftErrorRpm { get; set; }
    public double LaunchRpm { get; set; }
    public int RespectWin { get; set; }
    public int RespectLoss { get; set; }
    public bool Available { get; set; }
    public bool ComingSoon { get; set; }
}

public sealed class DragCatalogProvider
{
    public DragCatalog Catalog { get; }

    /// <summary>JSON original, entregue como está em /api/drag/catalog.</summary>
    public byte[] RawJson { get; }

    public DragCatalogProvider(IWebHostEnvironment env)
    {
        var path = Path.Combine(env.ContentRootPath, "Drag", "catalog.json");
        RawJson = File.ReadAllBytes(path);
        Catalog = JsonSerializer.Deserialize<DragCatalog>(RawJson, new JsonSerializerOptions(JsonSerializerDefaults.Web))
                  ?? throw new InvalidOperationException("Drag/catalog.json inválido.");
        if (Catalog.FindCar(Catalog.StarterCar) is null)
            throw new InvalidOperationException("starterCar do catálogo não existe em cars.");
    }
}
