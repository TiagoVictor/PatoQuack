using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using PatoQuack.Server.Api;
using PatoQuack.Server.Tests.Infrastructure;

namespace PatoQuack.Server.Tests.Api;

[Collection(PostgresCollection.Name)]
public sealed class ServerEndpointsTests(PostgresFixture db)
{
    [Fact]
    public async Task Owner_creates_server_and_sees_invite_and_permissions()
    {
        var owner = await db.RegisterSessionAsync("Dono");

        var created = await owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("Amigos"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var server = (await created.Content.ReadFromJsonAsync<ServerDto>())!;

        Assert.True(server.IsOwner);
        Assert.Matches("^[a-z2-9]{12}$", await InviteCodeAsync(owner, server));
        Assert.Contains("manageChannels", server.Permissions);
        Assert.Contains("deleteServer", server.Permissions);
        Assert.Equal("geral", Assert.Single(server.Channels).Name);

        var mine = await owner.Client.GetFromJsonAsync<List<ServerSummaryDto>>("/api/servers");
        Assert.Equal(new ServerSummaryDto(server.Id, "Amigos", true), Assert.Single(mine!));
    }

    [Fact]
    public async Task Member_joins_by_invite_and_cannot_manage()
    {
        var owner = await db.RegisterSessionAsync("Dono");
        var server = (await (await owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("Amigos")))
            .Content.ReadFromJsonAsync<ServerDto>())!;
        var member = await db.RegisterSessionAsync("Bia");

        // Antes do convite, o servidor não aparece.
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/servers/{server.Id}")).StatusCode);

        var code = await InviteCodeAsync(owner, server);
        var invite = await member.Client.GetFromJsonAsync<InviteDto>($"/api/invites/{code.ToUpperInvariant()}");
        Assert.Equal(new InviteDto(server.Id, "Amigos", false), invite);
        var accepted = await member.Client.PostAsync($"/api/invites/{code}/accept", null);
        Assert.Equal(server.Id, (await accepted.Content.ReadFromJsonAsync<AcceptInviteDto>())!.ServerId);

        var seen = (await member.Client.GetFromJsonAsync<ServerDto>($"/api/servers/{server.Id}"))!;
        Assert.False(seen.IsOwner);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/servers/{server.Id}/invites")).StatusCode);
        Assert.Equal(["viewChannels", "connectVoice", "sendMessages", "viewMembers"], seen.Permissions);

        var forbidden = new[]
        {
            await member.Client.PostAsJsonAsync($"/api/servers/{server.Id}/channels", new NameRequest("Jogos")),
            await member.Client.PatchAsJsonAsync($"/api/servers/{server.Id}", new NameRequest("Meu")),
            await member.Client.DeleteAsync($"/api/servers/{server.Id}/channels/{server.Channels[0].Id}"),
            await member.Client.DeleteAsync($"/api/servers/{server.Id}"),
        };
        Assert.All(forbidden, r => Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode));
        Assert.Contains("dono", (await forbidden[0].Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);

        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync("/api/invites/naoexist")).StatusCode);
    }

    [Fact]
    public async Task Owner_manages_channels_and_deletes_the_server()
    {
        var owner = await db.RegisterSessionAsync("Dono");
        var server = (await (await owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("Amigos")))
            .Content.ReadFromJsonAsync<ServerDto>())!;
        var baseUrl = $"/api/servers/{server.Id}";

        var jogos = (await (await owner.Client.PostAsJsonAsync($"{baseUrl}/channels", new NameRequest("Jogos")))
            .Content.ReadFromJsonAsync<ChannelDto>())!;
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync($"{baseUrl}/channels", new NameRequest("JOGOS"))).StatusCode);

        var renamed = await owner.Client.PatchAsJsonAsync($"{baseUrl}/channels/{jogos.Id}", new NameRequest("Música"));
        Assert.Equal("Música", (await renamed.Content.ReadFromJsonAsync<ChannelDto>())!.Name);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PatchAsJsonAsync(baseUrl, new NameRequest("Novo"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"{baseUrl}/channels/{server.Channels[0].Id}")).StatusCode);

        var fetched = (await owner.Client.GetFromJsonAsync<ServerDto>(baseUrl))!;
        Assert.Equal("Novo", fetched.Name);
        Assert.Equal(["Música"], fetched.Channels.Select(c => c.Name));

        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync(baseUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(baseUrl)).StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<List<ServerSummaryDto>>("/api/servers"))!);
    }

    [Fact]
    public async Task Members_are_listed_and_a_member_can_leave_but_the_owner_cannot()
    {
        var owner = await db.RegisterSessionAsync("Dono");
        var server = (await (await owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("Amigos")))
            .Content.ReadFromJsonAsync<ServerDto>())!;
        var member = await db.RegisterSessionAsync("Bia");
        await member.Client.PostAsync($"/api/invites/{await InviteCodeAsync(owner, server)}/accept", null);

        var members = await member.Client.GetFromJsonAsync<List<MemberDto>>($"/api/servers/{server.Id}/members");
        Assert.Equal([("Dono", true), ("Bia", false)], members!.Select(m => (m.Name, m.IsOwner)));

        var ownerLeaves = await owner.Client.PostAsync($"/api/servers/{server.Id}/leave", null);
        Assert.Equal(HttpStatusCode.Conflict, ownerLeaves.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await member.Client.PostAsync($"/api/servers/{server.Id}/leave", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/servers/{server.Id}")).StatusCode);
        Assert.Single((await owner.Client.GetFromJsonAsync<List<MemberDto>>($"/api/servers/{server.Id}/members"))!);
    }

    [Fact]
    public async Task Owner_creates_lists_and_revokes_invites()
    {
        var owner = await db.RegisterSessionAsync("Dono");
        var server = (await (await owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("Amigos")))
            .Content.ReadFromJsonAsync<ServerDto>())!;

        var created = await owner.Client.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new CreateInviteRequest(1, 1));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var invite = (await created.Content.ReadFromJsonAsync<ServerInviteDto>())!;
        Assert.Equal((1, 0), (invite.MaxUses, invite.Uses));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.Client.PostAsJsonAsync($"/api/servers/{server.Id}/invites", new CreateInviteRequest(5, 1))).StatusCode);

        var list = await owner.Client.GetFromJsonAsync<List<ServerInviteDto>>($"/api/servers/{server.Id}/invites");
        Assert.Equal([invite.Code, list![1].Code], list.Select(i => i.Code)); // o novo primeiro, depois o padrão

        // Uma pessoa entra e esgota o convite de 1 uso; a segunda recebe 404.
        var first = await db.RegisterSessionAsync("Bia");
        var second = await db.RegisterSessionAsync("Caio");
        Assert.Equal(HttpStatusCode.OK, (await first.Client.PostAsync($"/api/invites/{invite.Code}/accept", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await second.Client.PostAsync($"/api/invites/{invite.Code}/accept", null)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"/api/invites/{list[1].Code}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await second.Client.GetAsync($"/api/invites/{list[1].Code}")).StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<List<ServerInviteDto>>($"/api/servers/{server.Id}/invites"))!);
    }

    private static async Task<string> InviteCodeAsync(TestSession owner, ServerDto server) =>
        (await owner.Client.GetFromJsonAsync<List<ServerInviteDto>>($"/api/servers/{server.Id}/invites"))![0].Code;

    [Fact]
    public async Task Invalid_names_return_400()
    {
        var owner = await db.RegisterSessionAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("  "))).StatusCode);
    }
}
