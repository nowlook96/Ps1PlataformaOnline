namespace PlataformaOnline.Models;

public sealed record GameInfo(
    string Id,
    string Title,
    string FileName,
    string Url,
    string? CoverUrl,
    long SizeBytes);
