using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Application.Users;
using PatoQuack.Domain.Abstractions;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Chat;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Servers;
using PatoQuack.Domain.Users;
using PatoQuack.Infrastructure.Persistence;
using PatoQuack.Infrastructure.Persistence.Channels;
using PatoQuack.Infrastructure.Persistence.Chat;
using PatoQuack.Infrastructure.Persistence.Participants;
using PatoQuack.Infrastructure.Persistence.Servers;
using PatoQuack.Infrastructure.Persistence.Users;
using PatoQuack.Infrastructure.Security;

namespace PatoQuack.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringName = "PatoQuack";

    /// <summary>
    /// Registra os adaptadores de persistência (EF Core + PostgreSQL). Trocar de banco é trocar
    /// esta chamada: Domain e Application só conhecem as portas.
    /// </summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services)
    {
        // A connection string é lida ao criar o DbContext (e não aqui) para que testes possam
        // sobrescrever a configuração depois do registro.
        services.AddDbContext<PatoQuackDbContext>((sp, options) =>
        {
            var connectionString = sp.GetRequiredService<IConfiguration>().GetConnectionString(ConnectionStringName)
                ?? throw new InvalidOperationException(
                    $"Connection string '{ConnectionStringName}' não configurada (ConnectionStrings:{ConnectionStringName}).");
            options.UseNpgsql(connectionString);
        });

        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IServerRepository, ServerRepository>();
        services.AddScoped<IServerInviteRepository, ServerInviteRepository>();
        services.AddSingleton<IPasswordHasher, IdentityPasswordHasher>();
        services.AddScoped<IVoiceChannelRepository, VoiceChannelRepository>();
        services.AddScoped<IParticipantRepository, ParticipantRepository>();
        services.AddScoped<IChatMessageRepository, ChatMessageRepository>();
        return services;
    }

    /// <summary>Aplica as migrations pendentes.</summary>
    public static async Task MigrateDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PatoQuackDbContext>();
        await db.Database.MigrateAsync(cancellationToken);
    }
}
