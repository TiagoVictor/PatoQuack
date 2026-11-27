using PatoQuack.Server.Chat;
using PatoQuack.Server.Rooms;
using PatoQuack.Server.Voice;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<VoiceOptions>(builder.Configuration.GetSection(VoiceOptions.SectionName));

// Para escalar em várias instâncias: troque por uma implementação com Redis
// e adicione .AddStackExchangeRedis(...) no AddSignalR (backplane).
builder.Services.AddSingleton<IRoomRegistry, InMemoryRoomRegistry>();

// Chat de texto: mensagens num arquivo SQLite (caminho relativo = relativo à pasta do app).
builder.Services.Configure<ChatOptions>(builder.Configuration.GetSection(ChatOptions.SectionName));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IChatStore>(sp =>
{
    var path = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ChatOptions>>().Value.DatabasePath;
    return new SqliteChatStore(Path.IsPathRooted(path) ? path : Path.Combine(builder.Environment.ContentRootPath, path));
});
builder.Services.AddSingleton<ChatRateLimiter>();
builder.Services.AddHostedService<ChatRetentionService>();

builder.Services.AddSignalR(options =>
{
    // Sinalização é pequena (SDP de áudio fica em poucos KB) e o chat limita a 2.000 caracteres.
    options.MaximumReceiveMessageSize = 32 * 1024;
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Sem isto o navegador pode reaproveitar um app.js antigo do cache (heurística por
    // Last-Modified) e falar um protocolo diferente do hub. "no-cache" = sempre revalida
    // com o ETag: se nada mudou, a resposta é um 304 rápido.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

app.MapHub<VoiceHub>(VoiceHub.Path);

app.Run();
