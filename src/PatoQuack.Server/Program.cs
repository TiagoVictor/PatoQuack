using Microsoft.AspNetCore.Authentication.Cookies;
using PatoQuack.Application;
using PatoQuack.Application.Chat;
using PatoQuack.Application.Users;
using PatoQuack.Application.Servers;
using PatoQuack.Application.Voice;
using PatoQuack.Infrastructure;
using PatoQuack.Server.Api;
using PatoQuack.Server.Chat;
using PatoQuack.Server.Voice;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<VoiceOptions>(builder.Configuration.GetSection(VoiceOptions.SectionName));
builder.Services.Configure<ServerOptions>(builder.Configuration.GetSection(ServerOptions.SectionName));
builder.Services.Configure<ChatOptions>(builder.Configuration.GetSection(ChatOptions.SectionName));
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.SectionName));
builder.Services.AddApiRateLimiting(builder.Configuration);
builder.Services.AddProblemDetails();

// Hexagonal: a aplicação (casos de uso) depende só das portas; a infraestrutura (EF Core +
// PostgreSQL) fornece os adaptadores. Trocar de banco = trocar o AddInfrastructure.
builder.Services.AddApplication();
builder.Services.AddInfrastructure();
builder.Services.AddScoped<VoicePresence>();
builder.Services.AddHostedService<ChatRetentionService>();

// Sessão por cookie HttpOnly: o navegador manda sozinho nas chamadas à API e na conexão do
// SignalR. SameSite=Lax impede que outro site faça POST autenticado em nome do usuário.
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "pq.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromDays(14);
        options.SlidingExpiration = true;
        // É uma API: sem redirecionar para página de login, só 401/403.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

// O front (PatoQuack.Web) é um projeto separado. Em desenvolvimento o `ng serve` faz proxy de
// /api e /hubs (mesma origem, sem CORS); publicado em outro domínio, libere a origem aqui.
const string FrontendCorsPolicy = "frontend";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddPolicy(FrontendCorsPolicy, policy => policy
    .WithOrigins(allowedOrigins)
    .AllowAnyHeader()
    .WithMethods("GET", "POST", "PATCH", "DELETE")
    .AllowCredentials())); // o SignalR negocia com credenciais

builder.Services.AddSignalR(options =>
{
    // Mensagens de sinalização são pequenas (SDP de áudio fica em poucos KB).
    options.MaximumReceiveMessageSize = 32 * 1024;
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
});

var app = builder.Build();

if (app.Configuration.GetValue("Database:ApplyMigrationsOnStartup", false))
{
    await app.Services.MigrateDatabaseAsync();
}

// As conexões SignalR de antes do restart não existem mais: limpa a presença nos canais.
// Servidores e canais ficam. (Com várias instâncias isto precisaria ser por instância.)
await using (var scope = app.Services.CreateAsyncScope())
{
    await scope.ServiceProvider.GetRequiredService<IVoiceSessionService>().ResetPresenceAsync();
}

app.UseExceptionHandler();
app.UseCors(FrontendCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapAuthEndpoints();
app.MapServerEndpoints();
app.MapHub<VoiceHub>(VoiceHub.Path);
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

// Exposto para o WebApplicationFactory dos testes de integração.
public partial class Program;
