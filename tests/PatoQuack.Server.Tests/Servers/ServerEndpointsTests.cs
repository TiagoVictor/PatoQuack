using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using PatoQuack.Server.Chat;
using PatoQuack.Server.Servers;

namespace PatoQuack.Server.Tests.Servers;

/// <summary>Servidores: dono × membro × fora, convites com limite e remoção da chamada.</summary>
public sealed class ServerEndpointsTests(PatoQuackFactory factory) : IClassFixture<PatoQuackFactory>, IAsyncDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly List<IDisposable> _http = [];
    private readonly List<HubTestClient> _hubs = [];

    [Fact]
    public async Task Owner_member_and_outsider_permissions()
    {
        var (owner, _) = await UserAsync("Dona");
        var (member, _) = await UserAsync("Membro");
        var (outsider, _) = await UserAsync("Fora");

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/servers", new { name = "  " })).StatusCode);
        var server = await CreateServerAsync(owner, "Turma");
        Assert.Equal("Geral", Assert.Single(server.Channels).Name);
        Assert.Equal("voice", server.Channels[0].Kind);
        await JoinByInviteAsync(owner, member, server.Id);

        // Membro: vê membros, convida; não renomeia, não apaga, não lista convites.
        var members = await member.GetFromJsonAsync<List<MemberDto>>($"/api/servers/{server.Id}/members", Json);
        Assert.Equal(["Dona", "Membro"], members!.Select(m => m.DisplayName));
        Assert.True(members[0].IsOwner);
        Assert.Equal(HttpStatusCode.OK, (await member.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new { expiresInDays = 1, maxUses = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PatchAsJsonAsync($"/api/servers/{server.Id}", new { name = "Hackeado" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.DeleteAsync($"/api/servers/{server.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/api/servers/{server.Id}/invites")).StatusCode);

        // Quem não é membro: 404 em tudo (não revela que o servidor existe).
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/servers/{server.Id}/members")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PatchAsJsonAsync($"/api/servers/{server.Id}", new { name = "x" })).StatusCode);
        Assert.Empty((await outsider.GetFromJsonAsync<List<ServerDto>>("/api/servers", Json))!);

        // Dono renomeia e apaga.
        Assert.Equal(HttpStatusCode.OK, (await owner.PatchAsJsonAsync($"/api/servers/{server.Id}", new { name = "Turma Nova" })).StatusCode);
        Assert.Equal("Turma Nova", (await member.GetFromJsonAsync<List<ServerDto>>("/api/servers", Json))!.Single().Name);
        Assert.Equal(HttpStatusCode.OK, (await owner.DeleteAsync($"/api/servers/{server.Id}")).StatusCode);
        Assert.Empty((await member.GetFromJsonAsync<List<ServerDto>>("/api/servers", Json))!);
    }

    [Fact]
    public async Task Invites_respect_limits_and_revocation()
    {
        var (owner, _) = await UserAsync("Dona");
        var (b, _) = await UserAsync("B");
        var (c, _) = await UserAsync("C");
        var server = await CreateServerAsync(owner, "Limites");

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new { expiresInDays = 3, maxUses = 10 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new { expiresInDays = 7, maxUses = 5 })).StatusCode);

        // Padrão: 7 dias, 10 usos.
        var standard = await (await owner.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new { })).Content.ReadFromJsonAsync<ServerInviteDto>(Json);
        Assert.Equal(10, standard!.MaxUses);
        Assert.InRange(standard.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(6.9), TimeSpan.FromDays(7.1));

        var single = await (await owner.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new { expiresInDays = 1, maxUses = 1 })).Content.ReadFromJsonAsync<ServerInviteDto>(Json);
        var info = await b.GetFromJsonAsync<InviteInfoDto>($"/api/invites/{single!.Code}", Json);
        Assert.True(info!.Valid);
        Assert.False(info.AlreadyMember);
        Assert.Equal(HttpStatusCode.OK, (await b.PostAsync($"/api/invites/{single.Code}/accept", null)).StatusCode);
        // Quem já é membro aceita de novo sem gastar uso…
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsync($"/api/invites/{single.Code}/accept", null)).StatusCode);
        // …mas o único uso já foi: C não entra.
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync($"/api/invites/{single.Code}/accept", null)).StatusCode);

        // Convites ativos (só o dono vê); revogar invalida.
        var active = await owner.GetFromJsonAsync<List<ServerInviteDto>>($"/api/servers/{server.Id}/invites", Json);
        Assert.Equal([standard.Code], active!.Select(i => i.Code));
        Assert.Equal(HttpStatusCode.NotFound, (await c.DeleteAsync($"/api/invites/{standard.Code}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.DeleteAsync($"/api/invites/{standard.Code}")).StatusCode);
        Assert.False((await c.GetFromJsonAsync<InviteInfoDto>($"/api/invites/{standard.Code}", Json))!.Valid);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync($"/api/invites/{standard.Code}/accept", null)).StatusCode);
    }

    [Fact]
    public async Task Leaving_the_server_removes_from_the_call_and_the_chat()
    {
        var (owner, ownerCookie) = await UserAsync("Dona");
        var (member, memberCookie) = await UserAsync("Membro");
        var server = await CreateServerAsync(owner, "Saída");
        await JoinByInviteAsync(owner, member, server.Id);
        var channel = server.Channels[0].Id;

        var ownerHub = await HubAsync(ownerCookie);
        var memberHub = await HubAsync(memberCookie);
        await ownerHub.JoinAsync(channel);
        await memberHub.JoinAsync(channel);
        await memberHub.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "antes de sair");

        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync($"/api/servers/{server.Id}/leave", null)).StatusCode); // dono não sai
        Assert.Equal(HttpStatusCode.OK, (await member.PostAsync($"/api/servers/{server.Id}/leave", null)).StatusCode);

        Assert.Equal(["Você saiu do servidor."], await memberHub.NextAsync("Kicked"));
        Assert.Equal([memberHub.Id], await ownerHub.NextAsync("UserLeft"));
        await Assert.ThrowsAsync<HubException>(() => memberHub.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "depois"));
        await Assert.ThrowsAsync<HubException>(() => memberHub.JoinAsync(channel));
    }

    [Fact]
    public async Task Deleting_the_server_removes_everyone_from_the_call()
    {
        var (owner, ownerCookie) = await UserAsync("Dona");
        var (member, memberCookie) = await UserAsync("Membro");
        var server = await CreateServerAsync(owner, "Apagar");
        await JoinByInviteAsync(owner, member, server.Id);

        var ownerHub = await HubAsync(ownerCookie);
        var memberHub = await HubAsync(memberCookie);
        await ownerHub.JoinAsync(server.Channels[0].Id);
        await memberHub.JoinAsync(server.Channels[0].Id);

        Assert.Equal(HttpStatusCode.OK, (await owner.DeleteAsync($"/api/servers/{server.Id}")).StatusCode);
        Assert.Equal(["O servidor foi apagado."], await ownerHub.NextAsync("Kicked"));
        Assert.Equal(["O servidor foi apagado."], await memberHub.NextAsync("Kicked"));
        await Assert.ThrowsAsync<HubException>(() => memberHub.JoinAsync(server.Channels[0].Id));
    }

    // ---- apoio --------------------------------------------------------------------

    /// <summary>Conta nova, logada: cliente HTTP (com cookies) e o cookie para o hub.</summary>
    private async Task<(HttpClient Http, string Cookie)> UserAsync(string name)
    {
        var user = await factory.CreateUserAsync(name);
        var http = factory.CreateApiClient();
        _http.Add(http);
        (await http.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = PatoQuackFactory.Password })).EnsureSuccessStatusCode();
        return (http, await factory.LoginCookieAsync(user.Email!));
    }

    private static async Task<ServerDto> CreateServerAsync(HttpClient owner, string name)
    {
        var response = await owner.PostAsJsonAsync("/api/servers", new { name });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ServerDto>(Json))!;
    }

    private static async Task JoinByInviteAsync(HttpClient owner, HttpClient joiner, int serverId)
    {
        var invite = await (await owner.PostAsJsonAsync($"/api/servers/{serverId}/invites", new { })).Content.ReadFromJsonAsync<ServerInviteDto>(Json);
        (await joiner.PostAsync($"/api/invites/{invite!.Code}/accept", null)).EnsureSuccessStatusCode();
    }

    private async Task<HubTestClient> HubAsync(string cookie)
    {
        var hub = await HubTestClient.ConnectWithCookieAsync(factory, cookie);
        _hubs.Add(hub);
        return hub;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var hub in _hubs) await hub.Connection.DisposeAsync();
        foreach (var http in _http) http.Dispose();
    }
}
