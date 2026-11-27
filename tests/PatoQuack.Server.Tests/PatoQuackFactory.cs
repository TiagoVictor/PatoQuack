using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Server.Data;
using ServerEntity = PatoQuack.Server.Data.Server; // "Server" colide com o namespace

namespace PatoQuack.Server.Tests;

/// <summary>
/// Servidor de teste com banco e pasta de e-mails próprios (temporários, apagados no fim) e sem
/// limite de tentativas de login (os testes fazem muitas).
/// </summary>
public sealed class PatoQuackFactory : WebApplicationFactory<Program>
{
    public const string Password = "senha-de-teste-123";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"patoquack-test-{Guid.NewGuid():N}");

    public string MailDirectory => Path.Combine(_dir, "mail");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:App", $"Data Source={Path.Combine(_dir, "test.db")}");
        builder.UseSetting("Email:Mode", "Pickup");
        builder.UseSetting("Email:PickupDirectory", MailDirectory);
        builder.UseSetting("Auth:RateLimitPerMinute", "100000");
    }

    /// <summary>Cria uma conta já confirmada direto no banco.</summary>
    public async Task<AppUser> CreateUserAsync(string displayName, bool isAdmin = false)
    {
        using var scope = Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var email = $"{Guid.NewGuid():N}@teste.local";
        var user = new AppUser { UserName = email, Email = email, DisplayName = displayName, EmailConfirmed = true, IsAdmin = isAdmin, CreatedAt = DateTimeOffset.UtcNow };
        var result = await users.CreateAsync(user, Password);
        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Description)));
        return user;
    }

    /// <summary>Cria um servidor (com o canal de voz "Geral") cujo dono é a conta indicada.</summary>
    public async Task<(int ServerId, int ChannelId)> CreateServerAsync(string ownerId, string name = "Teste")
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var server = new ServerEntity
        {
            Name = name, OwnerId = ownerId, CreatedAt = DateTimeOffset.UtcNow,
            Members = [new ServerMember { UserId = ownerId, Role = ServerRole.Owner, JoinedAt = DateTimeOffset.UtcNow }],
            Channels = [new Channel { Name = "Geral", Kind = ChannelKind.Voice }],
        };
        db.Servers.Add(server);
        await db.SaveChangesAsync();
        return (server.Id, server.Channels[0].Id);
    }

    public async Task AddMemberAsync(int serverId, string userId)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.ServerMembers.Add(new ServerMember { ServerId = serverId, UserId = userId, Role = ServerRole.Member, JoinedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    /// <summary>Cliente HTTP que guarda cookies e manda o cabeçalho anti-CSRF.</summary>
    public HttpClient CreateApiClient()
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("X-PatoQuack", "1");
        return client;
    }

    /// <summary>Faz login e devolve o cabeçalho Cookie da sessão (para conexões SignalR).</summary>
    public async Task<string> LoginCookieAsync(string email, string password = Password)
    {
        using var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login") { Content = JsonContent.Create(new { email, password }) };
        request.Headers.Add("X-PatoQuack", "1");
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var cookie = response.Headers.GetValues("Set-Cookie").First(c => c.StartsWith("patoquack.auth="));
        return cookie.Split(';')[0];
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { /* arquivo preso: o SO limpa a pasta temporária */ }
    }
}
