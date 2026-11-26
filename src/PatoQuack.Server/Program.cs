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
app.UseStaticFiles();

app.MapHub<VoiceHub>(VoiceHub.Path);

app.Run();
