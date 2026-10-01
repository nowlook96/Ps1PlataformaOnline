using System.IO.Compression;
using System.Text.RegularExpressions;
using PlataformaOnline.Models;

namespace PlataformaOnline.Services;

public sealed class GameLibraryService
{
    private static readonly string[] GameExtensions = [".chd", ".pbp", ".iso", ".img", ".cue", ".zip", ".7z", ".bin"];
    private static readonly string[] CoverExtensions = [".png", ".jpg", ".jpeg", ".webp"];
    private static readonly string[] BiosNames = ["scph5501.bin", "scph5500.bin", "scph5502.bin", "scph1001.bin", "scph7001.bin", "scph101.bin"];

    public string GamesPath { get; }
    public string BiosPath { get; }

    public GameLibraryService(IConfiguration config, IWebHostEnvironment env)
    {
        GamesPath = ResolveFolder(env, config["GamesFolder"] ?? "Jogos");
        BiosPath = ResolveFolder(env, config["BiosFolder"] ?? "Bios");
    }

    private static string ResolveFolder(IWebHostEnvironment env, string folder)
    {
        var path = Path.IsPathRooted(folder) ? folder : Path.Combine(env.ContentRootPath, folder);
        Directory.CreateDirectory(path);
        return path;
    }

    public IReadOnlyList<GameInfo> GetGames()
    {
        var files = Directory.EnumerateFiles(GamesPath)
            .Where(f => GameExtensions.Contains(Path.GetExtension(f).ToLowerInvariant()))
            .ToList();

        // A .bin acompanhado de um .cue com o mesmo nome é listado só pelo .cue.
        var cueNames = files
            .Where(f => Path.GetExtension(f).Equals(".cue", StringComparison.OrdinalIgnoreCase))
            .Select(Path.GetFileNameWithoutExtension)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return files
            .Where(f => !(Path.GetExtension(f).Equals(".bin", StringComparison.OrdinalIgnoreCase)
                          && cueNames.Contains(Path.GetFileNameWithoutExtension(f))))
            .OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
            .Select(ToGameInfo)
            .ToList();
    }

    public string? GetBiosUrl()
    {
        foreach (var name in BiosNames)
        {
            var match = Directory.EnumerateFiles(BiosPath)
                .FirstOrDefault(f => Path.GetFileName(f).Equals(name, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
                return "/bios/" + Uri.EscapeDataString(Path.GetFileName(match));
        }

        var any = Directory.EnumerateFiles(BiosPath, "*.bin").FirstOrDefault();
        return any is null ? null : "/bios/" + Uri.EscapeDataString(Path.GetFileName(any));
    }

    /// <summary>
    /// Gera (ou reaproveita do cache) um .zip sem compressão com o .cue e os arquivos que ele referencia.
    /// Retorna null se o .cue não existir.
    /// </summary>
    public string? GetCueZip(string baseName)
    {
        if (baseName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            return null;

        var cuePath = Path.Combine(GamesPath, baseName + ".cue");
        if (!File.Exists(cuePath))
            return null;

        var tracks = new List<string> { cuePath };
        foreach (var line in File.ReadLines(cuePath))
        {
            var m = Regex.Match(line, "^\\s*FILE\\s+(?:\"([^\"]+)\"|(\\S+))", RegexOptions.IgnoreCase);
            if (!m.Success) continue;
            var name = Path.GetFileName(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value);
            var trackPath = Path.Combine(GamesPath, name);
            if (File.Exists(trackPath) && !tracks.Contains(trackPath, StringComparer.OrdinalIgnoreCase))
                tracks.Add(trackPath);
        }

        var cacheDir = Path.Combine(Path.GetTempPath(), "PlataformaOnline", "cue-zip");
        Directory.CreateDirectory(cacheDir);
        var zipPath = Path.Combine(cacheDir, baseName + ".zip");

        lock (_zipLock)
        {
            var newestSource = tracks.Max(File.GetLastWriteTimeUtc);
            if (File.Exists(zipPath) && File.GetLastWriteTimeUtc(zipPath) >= newestSource)
                return zipPath;

            var tmp = zipPath + ".tmp";
            using (var zip = ZipFile.Open(tmp, ZipArchiveMode.Create))
            {
                foreach (var track in tracks)
                    zip.CreateEntryFromFile(track, Path.GetFileName(track), CompressionLevel.NoCompression);
            }
            File.Move(tmp, zipPath, overwrite: true);
            return zipPath;
        }
    }

    private readonly object _zipLock = new();

    private GameInfo ToGameInfo(string path)
    {
        var fileName = Path.GetFileName(path);
        var baseName = Path.GetFileNameWithoutExtension(path);
        var cover = CoverExtensions
            .Select(ext => Path.Combine(GamesPath, baseName + ext))
            .FirstOrDefault(File.Exists);

        // O EmulatorJS baixa uma única URL: um .cue sozinho não traz os .bin, então é servido como .zip (cue + faixas).
        var isCue = Path.GetExtension(path).Equals(".cue", StringComparison.OrdinalIgnoreCase);

        return new GameInfo(
            Id: baseName.ToLowerInvariant(),
            Title: baseName.Replace('_', ' '),
            FileName: fileName,
            Url: isCue
                ? "/api/cue-zip/" + Uri.EscapeDataString(baseName) + ".zip"
                : "/jogos/" + Uri.EscapeDataString(fileName),
            CoverUrl: cover is null ? null : "/jogos/" + Uri.EscapeDataString(Path.GetFileName(cover)),
            SizeBytes: new FileInfo(path).Length);
    }
}
