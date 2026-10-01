using Microsoft.Extensions.FileProviders;
using PlataformaOnline.Components;
using PlataformaOnline.Security;
using PlataformaOnline.Services;

var builder = WebApplication.CreateBuilder(args);
builder.AddPlatformSecurity();

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddSingleton<GameLibraryService>();

var app = builder.Build();

// Cabeçalhos do túnel, limite de requisições, cabeçalhos de segurança e chave de acesso (Security/SecuritySetup.cs).
app.UsePlatformSecurity();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseStaticFiles();

var library = app.Services.GetRequiredService<GameLibraryService>();

// Jogos e BIOS servidos como arquivos binários (com suporte a range requests).
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(library.GamesPath),
    RequestPath = "/jogos",
    ServeUnknownFileTypes = true,
    DefaultContentType = "application/octet-stream"
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(library.BiosPath),
    RequestPath = "/bios",
    ServeUnknownFileTypes = true,
    DefaultContentType = "application/octet-stream"
});

app.UseAntiforgery();

app.MapGet("/api/games", (GameLibraryService lib) => Results.Ok(lib.GetGames()));
app.MapGet("/api/cue-zip/{name}.zip", (string name, GameLibraryService lib) =>
    lib.GetCueZip(name) is { } zip
        ? Results.File(zip, "application/zip", name + ".zip", enableRangeProcessing: true)
        : Results.NotFound());
app.MapGet("/api/bios",(GameLibraryService lib) => Results.Ok(new { url = lib.GetBiosUrl() }));

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
