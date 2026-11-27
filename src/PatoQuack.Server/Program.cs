using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PatoQuack.Server.Auth;
using PatoQuack.Server.Chat;
using PatoQuack.Server.Data;
using PatoQuack.Server.Email;
using PatoQuack.Server.Rooms;
using PatoQuack.Server.Voice;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<VoiceOptions>(builder.Configuration.GetSection(VoiceOptions.SectionName));
builder.Services.AddSingleton(TimeProvider.System);

// ---- banco (EF Core + SQLite) ------------------------------------------------------------
// Caminho relativo no "Data Source" = relativo à pasta do app. Trocar para PostgreSQL = trocar
// UseSqlite por UseNpgsql (e gerar migrações para ele).
var connection = new SqliteConnectionStringBuilder(builder.Configuration.GetConnectionString("App") ?? "Data Source=storage/patoquack.db");
if (!Path.IsPathRooted(connection.DataSource))
{
    connection.DataSource = Path.Combine(builder.Environment.ContentRootPath, connection.DataSource);
}
Directory.CreateDirectory(Path.GetDirectoryName(connection.DataSource)!);
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite(connection.ToString()));

// ---- contas (ASP.NET Core Identity, cookie de sessão) ----------------------------------------
builder.Services
    .AddIdentityCore<AppUser>(o =>
    {
        o.User.RequireUniqueEmail = true;
        o.SignIn.RequireConfirmedEmail = true;
        o.Password.RequiredLength = 10;
        o.Password.RequireDigit = false;
        o.Password.RequireLowercase = false;
        o.Password.RequireUppercase = false;
        o.Password.RequireNonAlphanumeric = false;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        o.Lockout.AllowedForNewUsers = true;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddSignInManager()
    .AddDefaultTokenProviders()
    .AddClaimsPrincipalFactory<AppClaimsFactory>()
    .AddErrorDescriber<PtBrIdentityErrorDescriber>();
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "patoquack.auth";
    o.Cookie.HttpOnly = true;
    // Lax (e não Strict): quem chega por um link de convite (WhatsApp etc.) continua logado.
    // Requisições que mudam estado exigem o cabeçalho X-PatoQuack (ver AuthEndpoints).
    o.Cookie.SameSite = SameSiteMode.Lax;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // HTTPS em produção → cookie Secure
    o.ExpireTimeSpan = TimeSpan.FromDays(30);
    o.SlidingExpiration = true;
    // É uma API: sem redirecionar para página de login.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();

// Limite por IP nas rotas de conta (contra tentativa de senha em massa). Atrás de um proxy
// reverso na VPS, configure os cabeçalhos encaminhados para o IP real chegar aqui.
var authPerMinute = builder.Configuration.GetValue("Auth:RateLimitPerMinute", 20);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy(AuthEndpoints.RateLimitPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "desconhecido",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authPerMinute, Window = TimeSpan.FromMinutes(1) }));
});

// ---- e-mail -------------------------------------------------------------------------------
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection(EmailOptions.SectionName));
builder.Services.Configure<AppOptions>(builder.Configuration.GetSection(AppOptions.SectionName));
builder.Services.AddSingleton<AppLinks>();
if (builder.Configuration.GetValue<string>("Email:Mode") == "Smtp")
{
    builder.Services.AddSingleton<IAppEmailSender, SmtpEmailSender>();
}
else
{
    builder.Services.AddSingleton<IAppEmailSender, PickupEmailSender>();
}

// ---- salas, chat e sinalização ----------------------------------------------------------------
// Para escalar em várias instâncias: troque por uma implementação com Redis
// e adicione .AddStackExchangeRedis(...) no AddSignalR (backplane).
builder.Services.AddSingleton<IRoomRegistry, InMemoryRoomRegistry>();
builder.Services.Configure<ChatOptions>(builder.Configuration.GetSection(ChatOptions.SectionName));
builder.Services.AddScoped<IChatStore, EfChatStore>();
builder.Services.AddSingleton<ChatRateLimiter>();
builder.Services.AddHostedService<ChatRetentionService>();

builder.Services.AddSignalR(options =>
{
    // Sinalização é pequena (SDP de áudio fica em poucos KB) e o chat limita a 2.000 caracteres.
    options.MaximumReceiveMessageSize = 32 * 1024;
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
});

var app = builder.Build();

// Cria/atualiza as tabelas ao iniciar (migrações do EF em Data/Migrations).
using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Sem isto o navegador pode reaproveitar um app.js antigo do cache (heurística por
    // Last-Modified) e falar um protocolo diferente do hub. "no-cache" = sempre revalida
    // com o ETag: se nada mudou, a resposta é um 304 rápido.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapHub<VoiceHub>(VoiceHub.Path);

app.Run();
