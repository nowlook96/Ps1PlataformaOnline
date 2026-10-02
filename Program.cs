using Microsoft.Extensions.FileProviders;
using PlataformaOnline.Components;
using PlataformaOnline.Drag;
using PlataformaOnline.Security;
using PlataformaOnline.Services;

var builder = WebApplication.CreateBuilder(args);
builder.AddPlatformSecurity();

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddSingleton<GameLibraryService>();
builder.AddDragGame();

var app = builder.Build();

// Cabeçalhos do túnel, limite de requisições, cabeçalhos de segurança e chave de acesso (Security/SecuritySetup.cs).
app.UsePlatformSecurity();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseHttpsRedirection();

// Modelos 3D (.glb) dos carros do jogo de arrancada.
var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
contentTypes.Mappings[".glb"] = "model/gltf-binary";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    // Arquivos do site sempre revalidados (ETag → 304 barato): depois de uma atualização ninguém fica com JS velho,
    // e a física do jogo de arrancada no navegador precisa ser a mesma do servidor.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});

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

// Jogo de arrancada: página /arrancada e API /api/drag (Drag/).
app.MapDragGame();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
