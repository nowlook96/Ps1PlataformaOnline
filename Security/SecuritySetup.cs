using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;

namespace PlataformaOnline.Security;

/// <summary>
/// Proteções para expor o site na internet (ex.: via Cloudflare Tunnel) durante apresentações.
/// Tudo vem do próprio ASP.NET Core 8, sem pacotes extras.
/// </summary>
public static class SecuritySetup
{
    private const string AccessCookie = "po_acesso";
    private const string AccessQuery = "chave";

    // CSP: só o próprio site e as CDNs usadas (Three.js no jsDelivr, EmulatorJS no cdn.emulatorjs.org).
    // 'unsafe-inline'/'unsafe-eval'/'wasm-unsafe-eval' e blob: são exigidos pelo EmulatorJS (WebAssembly + workers).
    private const string ContentSecurityPolicy =
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://cdn.emulatorjs.org; " +
        "style-src 'self' 'unsafe-inline' https://cdn.emulatorjs.org; " +
        "img-src 'self' data: blob: https://cdn.emulatorjs.org; " +
        "font-src 'self' data: https://cdn.emulatorjs.org; " +
        "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://cdn.emulatorjs.org; " +
        "media-src 'self' blob: data:; " +
        "worker-src 'self' blob:; " +
        "frame-src 'self'; " +
        "frame-ancestors 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'";

    public static void AddPlatformSecurity(this WebApplicationBuilder builder)
    {
        builder.WebHost.ConfigureKestrel(o =>
        {
            o.AddServerHeader = false;                         // não anuncia "Kestrel"
            o.Limits.MaxRequestBodySize = 64 * 1024;           // o site não recebe uploads
            o.Limits.MaxConcurrentConnections = 200;
            o.Limits.MaxConcurrentUpgradedConnections = 100;   // conexões do Blazor (WebSocket)
            o.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
        });

        // O túnel (cloudflared) roda na mesma máquina e repassa IP real e HTTPS nesses cabeçalhos.
        // Só proxies em loopback são aceitos (padrão do ASP.NET Core).
        builder.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.ForwardLimit = 1;
        });

        // Limite de requisições por visitante: barra robôs e tentativas de força bruta.
        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = (ctx, token) =>
            {
                ctx.HttpContext.Response.Headers.RetryAfter = "60";
                ctx.HttpContext.Response.ContentType = "text/plain; charset=utf-8";
                return new ValueTask(ctx.HttpContext.Response.WriteAsync(
                    "Muitas requisições em pouco tempo. Aguarde 1 minuto e recarregue a página.", token));
            };
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx), _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 300,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0
                }));
        });
    }

    public static void UsePlatformSecurity(this WebApplication app)
    {
        app.UseForwardedHeaders();
        app.UseRateLimiter();
        app.Use(SecurityHeaders);

        var key = app.Configuration["AccessKey"];
        if (!string.IsNullOrWhiteSpace(key))
        {
            if (key.Length < 16)
                throw new InvalidOperationException("AccessKey precisa ter pelo menos 16 caracteres.");
            var expected = Hash(key);
            app.Use((ctx, next) => RequireAccessKey(ctx, next, expected));
        }
        else if (!app.Environment.IsDevelopment())
        {
            app.Logger.LogWarning("AccessKey não definida: o site está aberto para qualquer pessoa com o link.");
        }
    }

    private static Task SecurityHeaders(HttpContext ctx, Func<Task> next)
    {
        var h = ctx.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["X-Frame-Options"] = "SAMEORIGIN";
        h["Referrer-Policy"] = "no-referrer";   // a chave nunca vaza para as CDNs pelo Referer
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        h["Permissions-Policy"] =
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), " +
            "gamepad=(self), fullscreen=(self), autoplay=(self)";
        h["Content-Security-Policy"] = ContentSecurityPolicy;
        return next();
    }

    /// <summary>
    /// Acesso por link com chave: /?chave=XXXX grava um cookie HttpOnly e redireciona para a URL sem a chave.
    /// Sem cookie válido, nada do site é entregue.
    /// </summary>
    private static Task RequireAccessKey(HttpContext ctx, Func<Task> next, byte[] expected)
    {
        var supplied = ctx.Request.Query[AccessQuery].ToString();
        if (supplied.Length > 0)
        {
            if (!FixedEquals(Hash(supplied), expected))
                return Deny(ctx);

            ctx.Response.Cookies.Append(AccessCookie, Convert.ToHexString(expected), new CookieOptions
            {
                HttpOnly = true,
                Secure = ctx.Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                IsEssential = true,
                MaxAge = TimeSpan.FromHours(12)
            });
            ctx.Response.Redirect(ctx.Request.PathBase + ctx.Request.Path);
            return Task.CompletedTask;
        }

        var cookie = ctx.Request.Cookies[AccessCookie];
        if (cookie is not null && cookie.Length == expected.Length * 2)
        {
            try
            {
                if (FixedEquals(Convert.FromHexString(cookie), expected))
                    return next();
            }
            catch (FormatException) { }
        }
        return Deny(ctx);
    }

    private static Task Deny(HttpContext ctx)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        ctx.Response.ContentType = "text/html; charset=utf-8";
        return ctx.Response.WriteAsync(
            "<!doctype html><meta charset=utf-8><title>Acesso restrito</title>" +
            "<body style=\"font-family:sans-serif;background:#111;color:#ddd;display:grid;place-items:center;height:100vh;margin:0\">" +
            "<div><h1>Acesso restrito</h1><p>Use o link completo enviado pelo apresentador.</p></div>");
    }

    /// <summary>Chave de limite por visitante: o IP real informado pelo túnel ou, sem túnel, o IP da conexão.</summary>
    private static string ClientKey(HttpContext ctx)
    {
        // Kestrel só escuta em 127.0.0.1, então este cabeçalho só pode ter vindo do cloudflared.
        var cf = ctx.Request.Headers["CF-Connecting-IP"].ToString();
        return cf.Length is > 0 and < 64 ? cf : ctx.Connection.RemoteIpAddress?.ToString() ?? "desconhecido";
    }

    private static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));

    private static bool FixedEquals(byte[] a, byte[] b) => CryptographicOperations.FixedTimeEquals(a, b);
}
