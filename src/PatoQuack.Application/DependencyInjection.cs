using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PatoQuack.Application.Chat;
using PatoQuack.Application.Servers;
using PatoQuack.Application.Users;
using PatoQuack.Application.Voice;

namespace PatoQuack.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<ChatRateLimiter>();
        services.AddScoped<IChatService, ChatService>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IServerService, ServerService>();
        services.AddScoped<IVoiceSessionService, VoiceSessionService>();
        return services;
    }
}
