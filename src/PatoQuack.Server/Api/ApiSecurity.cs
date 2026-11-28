using System.Threading.RateLimiting;
using PatoQuack.Application.Users;

namespace PatoQuack.Server.Api;

/// <summary>
/// Proteções comuns da API:
/// - CSRF: o cookie é SameSite=Lax e toda chamada que muda estado exige o cabeçalho
///   <c>X-PatoQuack: 1</c>. Um formulário de outro site não consegue mandá-lo sem passar pelo
///   CORS, que só libera as origens configuradas.
/// - Limite por IP nas rotas de conta e convite (dificulta adivinhar senhas e códigos).
/// </summary>
public static class ApiSecurity
{
    public const string CsrfHeader = "X-PatoQuack";
    public const string AuthRateLimitPolicy = "auth";

    public static async ValueTask<object?> RequireCsrfHeader(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.HttpContext.Request;
        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method) && request.Headers[CsrfHeader] != "1")
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Requisição recusada",
                detail: "Requisição recusada (cabeçalho de segurança ausente).");
        }

        return await next(context);
    }

    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var perMinute = configuration.GetSection(AuthOptions.SectionName).GetValue(nameof(AuthOptions.RateLimitPerMinute), 20);
        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(AuthRateLimitPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "desconhecido",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1) }));
        });
    }
}
