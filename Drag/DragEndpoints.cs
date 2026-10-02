using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using PlataformaOnline.Security;

namespace PlataformaOnline.Drag;

/// <summary>Página /arrancada e API /api/drag do jogo de arrancada.</summary>
public static class DragEndpoints
{
    public const string TokenHeader = "X-Drag-Token";
    private const string SignupPolicy = "drag-signup";
    private const string RacePolicy = "drag-race";

    public sealed record CreatePlayerRequest(string? Name);
    public sealed record StartRaceRequest(string? OpponentId);
    public sealed record FinishRaceRequest(int[][]? Events);

    public static void AddDragGame(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<DragCatalogProvider>();
        builder.Services.AddSingleton<DragStore>();
        builder.Services.AddSingleton<DragService>();

        // Limites extras por visitante, além do limite global de SecuritySetup.
        builder.Services.AddRateLimiter(o =>
        {
            o.AddPolicy(SignupPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(SecuritySetup.ClientKey(ctx),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
            o.AddPolicy(RacePolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(SecuritySetup.ClientKey(ctx),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 40, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
    }

    public static void MapDragGame(this WebApplication app)
    {
        var page = Path.Combine(app.Environment.WebRootPath, "arrancada", "index.html");
        app.MapGet("/arrancada", (HttpContext ctx) =>
        {
            ctx.Response.Headers.CacheControl = "no-cache";
            return Results.File(page, "text/html; charset=utf-8");
        });

        var api = app.MapGroup("/api/drag");
        api.AddEndpointFilter(async (ctx, next) =>
        {
            ctx.HttpContext.Response.Headers.CacheControl = "no-store";
            try { return await next(ctx); }
            catch (DragException ex) { return Results.Json(new { error = ex.Message }, statusCode: ex.Status); }
        });

        api.MapGet("/catalog", (DragCatalogProvider c) => Results.Bytes(c.RawJson, "application/json"));

        api.MapPost("/players", async (CreatePlayerRequest req, DragService svc) =>
        {
            var (player, token) = await svc.CreatePlayerAsync(req.Name);
            return Results.Ok(new { player, token });
        }).RequireRateLimiting(SignupPolicy);

        api.MapGet("/players/me", (HttpRequest r, DragService svc) => svc.GetPlayerAsync(Token(r)));

        api.MapGet("/leaderboard", (int? top, HttpRequest r, DragService svc) => svc.GetLeaderboardAsync(top ?? 10, Token(r)));

        api.MapPost("/races", (StartRaceRequest req, HttpRequest r, DragService svc) =>
            svc.StartRaceAsync(Token(r), req.OpponentId)).RequireRateLimiting(RacePolicy);

        api.MapPost("/races/{id}/finish", (string id, FinishRaceRequest req, HttpRequest r, DragService svc) =>
            svc.FinishRaceAsync(Token(r), id, req.Events)).RequireRateLimiting(RacePolicy);
    }

    private static string? Token(HttpRequest r) => r.Headers[TokenHeader].FirstOrDefault();
}
