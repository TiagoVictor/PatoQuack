using PatoQuack.Server.Rooms;
using PatoQuack.Server.Voice;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<VoiceOptions>(builder.Configuration.GetSection(VoiceOptions.SectionName));

// Para escalar em várias instâncias: troque por uma implementação com Redis
// e adicione .AddStackExchangeRedis(...) no AddSignalR (backplane).
builder.Services.AddSingleton<IRoomRegistry, InMemoryRoomRegistry>();

builder.Services.AddSignalR(options =>
{
    // Mensagens de sinalização são pequenas (SDP de áudio fica em poucos KB).
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
