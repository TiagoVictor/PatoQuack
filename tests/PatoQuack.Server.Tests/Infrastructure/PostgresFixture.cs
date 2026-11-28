using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Application;
using PatoQuack.Application.Servers;
using PatoQuack.Application.Users;
using PatoQuack.Application.Voice;
using PatoQuack.Domain.Users;
using PatoQuack.Infrastructure;
using PatoQuack.Server.Api;
using Testcontainers.PostgreSql;

namespace PatoQuack.Server.Tests.Infrastructure;

/// <summary>
/// Sobe um PostgreSQL descartável no Docker (Testcontainers) uma vez para todos os testes da
/// coleção "Postgres", aplica as migrations e expõe o servidor de testes apontando para ele.
/// Também cria usuários e servidores de teste (cada teste cria os seus, o banco é compartilhado).
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    public const string Password = "senha-de-teste";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17.6").Build();
    private WebApplicationFactory<Program>? _factory;

    public string ConnectionString => _container.GetConnectionString();

    /// <summary>Servidor completo (API + hub) usando o banco do container.</summary>
    public WebApplicationFactory<Program> Factory => _factory ??= new WebApplicationFactory<Program>()
        .WithWebHostBuilder(b => b.UseSetting($"ConnectionStrings:{PatoQuack.Infrastructure.DependencyInjection.ConnectionStringName}", ConnectionString));

    /// <summary>Container de DI só com Application + Infrastructure (sem ASP.NET), para testar os serviços.</summary>
    public ServiceProvider CreateServices(int maxParticipantsPerChannel = 6, int maxChannelsPerServer = 50)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [$"ConnectionStrings:{PatoQuack.Infrastructure.DependencyInjection.ConnectionStringName}"] = ConnectionString,
            })
            .Build();

        return new ServiceCollection()
            .AddSingleton<IConfiguration>(configuration)
            .Configure<VoiceOptions>(o => o.MaxParticipantsPerChannel = maxParticipantsPerChannel)
            .Configure<ServerOptions>(o => o.MaxChannelsPerServer = maxChannelsPerServer)
            .AddApplication()
            .AddInfrastructure()
            .BuildServiceProvider();
    }

    // ---- dados de teste pelos serviços ----------------------------------

    /// <summary>Cadastra um usuário com nome de usuário/e-mail únicos.</summary>
    public async Task<User> CreateUserAsync(string name = "Teste")
    {
        var handle = UniqueHandle();
        var result = await WithAsync<IAuthService, RegisterResult>(s =>
            s.RegisterAsync(new RegisterCommand(name, $"{handle}@teste.dev", handle, Password)));
        return result.User ?? throw new InvalidOperationException($"Cadastro falhou: {result.Status}");
    }

    /// <summary>Cria um servidor (com dono novo, se não informado).</summary>
    public async Task<TestServer> CreateServerAsync(Guid? ownerId = null)
    {
        var owner = ownerId ?? (await CreateUserAsync("Dono")).Id;
        var result = await WithAsync<IServerService, ServerOperationResult<ServerDetails>>(s => s.CreateServerAsync(owner, "Servidor"));
        var details = result.Value!;
        // O servidor nasce com um convite padrão (7 dias, até 10 pessoas).
        var invites = await WithAsync<IServerService, ServerOperationResult<IReadOnlyList<PatoQuack.Domain.Servers.ServerInvite>>>(
            s => s.ListInvitesAsync(owner, details.Server.Id));
        return new TestServer(details.Server.Id, details.Channels[0].Id, invites.Value![0].Code, owner);
    }

    /// <summary>Cadastra um usuário e o torna membro pelo convite.</summary>
    public async Task<Guid> CreateMemberAsync(string inviteCode, string name = "Membro")
    {
        var user = await CreateUserAsync(name);
        await WithAsync<IServerService, Guid?>(s => s.AcceptInviteAsync(user.Id, inviteCode));
        return user.Id;
    }

    // ---- dados de teste pela API (com sessão) ---------------------------

    /// <summary>Cliente HTTP já logado (cookie de sessão guardado no cliente e devolvido em <c>Cookie</c>).</summary>
    public async Task<TestSession> RegisterSessionAsync(string name = "Teste")
    {
        var handle = UniqueHandle();
        var client = CreateApiClient();
        var response = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest(name, $"{handle}@teste.dev", handle, Password));
        response.EnsureSuccessStatusCode();

        var cookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("pq.session=", StringComparison.Ordinal));
        var user = (await response.Content.ReadFromJsonAsync<UserDto>())!;
        return new TestSession(client, user, cookie.Split(';')[0]);
    }

    /// <summary>Cliente HTTP com cookies e o cabeçalho de segurança que o front manda (X-PatoQuack).</summary>
    public HttpClient CreateApiClient(bool handleCookies = true)
    {
        var client = Factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = handleCookies });
        client.DefaultRequestHeaders.Add(PatoQuack.Server.Api.ApiSecurity.CsrfHeader, "1");
        return client;
    }

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        await using var services = CreateServices();
        await services.MigrateDatabaseAsync();
    }

    public async Task DisposeAsync()
    {
        if (_factory is not null)
        {
            await _factory.DisposeAsync();
        }

        await _container.DisposeAsync();
    }

    private async Task<TResult> WithAsync<TService, TResult>(Func<TService, Task<TResult>> action)
        where TService : notnull
    {
        await using var services = CreateServices();
        await using var scope = services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<TService>());
    }

    /// <summary>Código de um convite novo sem limite de usos (para testes que põem muita gente no servidor).</summary>
    public Task<string> CreateUnlimitedInviteAsync(TestServer server) =>
        WithAsync<IServerService, string>(async s => (await s.CreateInviteAsync(server.OwnerId, server.ServerId, 30, null)).Value!.Code);

    private static string UniqueHandle() => $"u{Guid.NewGuid():N}"[..20];
}

public sealed record TestServer(Guid ServerId, Guid ChannelId, string InviteCode, Guid OwnerId);

public sealed record TestSession(HttpClient Client, UserDto User, string Cookie);

[CollectionDefinition(Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "Postgres";
}
