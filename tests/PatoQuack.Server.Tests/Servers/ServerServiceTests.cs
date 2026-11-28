using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Application.Servers;
using PatoQuack.Domain.Servers;
using PatoQuack.Server.Tests.Infrastructure;
using ServerInvite = PatoQuack.Domain.Servers.ServerInvite;

namespace PatoQuack.Server.Tests.Servers;

[Collection(PostgresCollection.Name)]
public sealed class ServerServiceTests(PostgresFixture db)
{
    [Fact]
    public async Task Create_makes_the_user_owner_with_invite_and_default_channel()
    {
        await using var services = db.CreateServices();
        var owner = await db.CreateUserAsync();

        var result = await RunAsync(services, s => s.CreateServerAsync(owner.Id, "  Amigos  "));

        Assert.True(result.Succeeded);
        var details = result.Value!;
        Assert.Equal("Amigos", details.Server.Name);
        Assert.Equal(owner.Id, details.Server.OwnerId);
        Assert.Equal("geral", Assert.Single(details.Channels).Name);

        // Nasce com um convite padrão: 12 caracteres, 7 dias, até 10 pessoas.
        var invite = Assert.Single((await RunAsync(services, s => s.ListInvitesAsync(owner.Id, details.Server.Id))).Value!);
        Assert.Matches("^[a-z2-9]{12}$", invite.Code);
        Assert.Equal(10, invite.MaxUses);
        Assert.Equal(7, Math.Round((invite.ExpiresAt!.Value - invite.CreatedAt).TotalDays));
        Assert.Equal(ServerPermission.All, details.Permissions);

        var mine = await RunAsync(services, s => s.ListServersAsync(owner.Id));
        Assert.Equal(details.Server.Id, Assert.Single(mine).Server.Id);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("um nome muito comprido que passa de trinta e dois")]
    public async Task Create_rejects_invalid_names(string name)
    {
        await using var services = db.CreateServices();
        var owner = await db.CreateUserAsync();
        Assert.Equal(ServerOperationStatus.InvalidName, (await RunAsync(services, s => s.CreateServerAsync(owner.Id, name))).Status);
    }

    [Fact]
    public async Task Invite_makes_the_user_a_member_without_management_rights()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();
        var user = await db.CreateUserAsync("Bia");

        var preview = await RunAsync(services, s => s.GetInviteAsync(user.Id, server.InviteCode.ToUpperInvariant()));
        Assert.Equal(server.ServerId, preview!.ServerId);
        Assert.False(preview.AlreadyMember);

        // Antes de aceitar, o servidor "não existe" para ele.
        Assert.Equal(ServerOperationStatus.NotFound, (await RunAsync(services, s => s.GetServerAsync(user.Id, server.ServerId))).Status);

        Assert.Equal(server.ServerId, await RunAsync(services, s => s.AcceptInviteAsync(user.Id, server.InviteCode)));
        Assert.Equal(server.ServerId, await RunAsync(services, s => s.AcceptInviteAsync(user.Id, server.InviteCode))); // idempotente
        Assert.True((await RunAsync(services, s => s.GetInviteAsync(user.Id, server.InviteCode)))!.AlreadyMember);

        var details = (await RunAsync(services, s => s.GetServerAsync(user.Id, server.ServerId))).Value!;
        Assert.Equal(ServerPermissions.Member, details.Permissions);
        Assert.Single(await RunAsync(services, s => s.ListServersAsync(user.Id)));

        Assert.Null(await RunAsync(services, s => s.AcceptInviteAsync(user.Id, "naoexist")));
    }

    [Fact]
    public async Task Only_the_owner_can_manage_the_server()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();
        var member = await db.CreateMemberAsync(server.InviteCode);
        var stranger = (await db.CreateUserAsync()).Id;

        foreach (var (user, expected) in new[] { (member, ServerOperationStatus.Forbidden), (stranger, ServerOperationStatus.NotFound) })
        {
            Assert.Equal(expected, (await RunAsync(services, s => s.CreateChannelAsync(user, server.ServerId, "Jogos"))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.RenameChannelAsync(user, server.ServerId, server.ChannelId, "x"))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.DeleteChannelAsync(user, server.ServerId, server.ChannelId))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.RenameServerAsync(user, server.ServerId, "x"))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.DeleteServerAsync(user, server.ServerId))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.CreateInviteAsync(user, server.ServerId, 7, 10))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.ListInvitesAsync(user, server.ServerId))).Status);
            Assert.Equal(expected, (await RunAsync(services, s => s.RevokeInviteAsync(user, server.InviteCode))).Status);
        }

        // Nada mudou.
        var details = (await RunAsync(services, s => s.GetServerAsync(server.OwnerId, server.ServerId))).Value!;
        Assert.Equal("Servidor", details.Server.Name);
        Assert.Equal("geral", Assert.Single(details.Channels).Name);
    }

    [Fact]
    public async Task Owner_creates_renames_and_deletes_channels()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();
        var owner = server.OwnerId;

        var jogos = await RunAsync(services, s => s.CreateChannelAsync(owner, server.ServerId, "Jogos"));
        Assert.True(jogos.Succeeded);
        Assert.Equal(ServerOperationStatus.NameTaken, (await RunAsync(services, s => s.CreateChannelAsync(owner, server.ServerId, "jogos"))).Status);
        Assert.Equal(ServerOperationStatus.InvalidName, (await RunAsync(services, s => s.CreateChannelAsync(owner, server.ServerId, ""))).Status);

        Assert.Equal(ServerOperationStatus.NameTaken, (await RunAsync(services, s => s.RenameChannelAsync(owner, server.ServerId, jogos.Value!.Id, "GERAL"))).Status);
        Assert.True((await RunAsync(services, s => s.RenameChannelAsync(owner, server.ServerId, jogos.Value!.Id, "JOGOS"))).Succeeded); // só muda a caixa
        Assert.Equal(ServerOperationStatus.NotFound, (await RunAsync(services, s => s.RenameChannelAsync(owner, server.ServerId, Guid.NewGuid(), "x"))).Status);

        var deleted = await RunAsync(services, s => s.DeleteChannelAsync(owner, server.ServerId, server.ChannelId));
        Assert.Equal([server.ChannelId], deleted.Value!.ChannelIds);

        var details = (await RunAsync(services, s => s.GetServerAsync(owner, server.ServerId))).Value!;
        Assert.Equal(["JOGOS"], details.Channels.Select(c => c.Name));
    }

    [Fact]
    public async Task Invite_options_are_validated()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();

        var unlimited = await RunAsync(services, s => s.CreateInviteAsync(server.OwnerId, server.ServerId, 30, null));
        Assert.True(unlimited.Succeeded);
        Assert.Null(unlimited.Value!.MaxUses);
        Assert.Equal(ServerOperationStatus.InvalidInviteOptions, (await RunAsync(services, s => s.CreateInviteAsync(server.OwnerId, server.ServerId, 2, 10))).Status);
        Assert.Equal(ServerOperationStatus.InvalidInviteOptions, (await RunAsync(services, s => s.CreateInviteAsync(server.OwnerId, server.ServerId, 7, 3))).Status);
    }

    [Fact]
    public async Task Invite_use_limit_is_enforced_even_with_concurrent_accepts()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();
        var code = (await RunAsync(services, s => s.CreateInviteAsync(server.OwnerId, server.ServerId, 1, 1))).Value!.Code;
        var users = new List<Guid>();
        for (var i = 0; i < 10; i++) users.Add((await db.CreateUserAsync($"U{i}")).Id);

        var results = await Task.WhenAll(users.Select(u => Task.Run(() => RunAsync(services, s => s.AcceptInviteAsync(u, code)))));

        Assert.Single(results, r => r == server.ServerId);
        Assert.Empty((await RunAsync(services, s => s.ListInvitesAsync(server.OwnerId, server.ServerId))).Value!.Where(i => i.Code == code));

        // Quem entrou continua chegando ao servidor pelo convite esgotado (sem gastar uso); os outros não.
        var joined = users[Array.FindIndex(results, r => r == server.ServerId)];
        Assert.Equal(server.ServerId, await RunAsync(services, s => s.AcceptInviteAsync(joined, code)));
        Assert.Null(await RunAsync(services, s => s.GetInviteAsync(users.First(u => u != joined), code)));
    }

    [Fact]
    public async Task Revoked_invites_stop_working()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();
        var user = await db.CreateUserAsync();

        Assert.True((await RunAsync(services, s => s.RevokeInviteAsync(server.OwnerId, server.InviteCode.ToUpperInvariant()))).Succeeded);

        Assert.Null(await RunAsync(services, s => s.GetInviteAsync(user.Id, server.InviteCode)));
        Assert.Null(await RunAsync(services, s => s.AcceptInviteAsync(user.Id, server.InviteCode)));
        Assert.Empty((await RunAsync(services, s => s.ListInvitesAsync(server.OwnerId, server.ServerId))).Value!);
    }

    [Fact]
    public void Invite_usability_respects_expiry_uses_and_revocation()
    {
        var now = DateTimeOffset.UtcNow;
        var expired = new ServerInvite(Guid.NewGuid(), Guid.NewGuid(), "abcdefghjkmn", Guid.NewGuid(), now.AddDays(-8), now.AddDays(-1), null);
        var forever = new ServerInvite(Guid.NewGuid(), Guid.NewGuid(), "abcd2345", Guid.NewGuid(), now, null, null);

        Assert.False(expired.IsUsable(now));
        Assert.True(forever.IsUsable(now.AddYears(5))); // código antigo (8 caracteres) migrado sem validade
        forever.Revoke(now);
        Assert.False(forever.IsUsable(now));
    }

    [Fact]
    public async Task Same_channel_name_is_allowed_in_different_servers()
    {
        await using var services = db.CreateServices();
        var a = await db.CreateServerAsync();
        var b = await db.CreateServerAsync();

        Assert.True((await RunAsync(services, s => s.CreateChannelAsync(a.OwnerId, a.ServerId, "Jogos"))).Succeeded);
        Assert.True((await RunAsync(services, s => s.CreateChannelAsync(b.OwnerId, b.ServerId, "Jogos"))).Succeeded);
    }

    [Fact]
    public async Task Channel_limit_is_enforced()
    {
        await using var services = db.CreateServices(maxChannelsPerServer: 2);
        var server = await db.CreateServerAsync();

        Assert.True((await RunAsync(services, s => s.CreateChannelAsync(server.OwnerId, server.ServerId, "Dois"))).Succeeded);
        Assert.Equal(ServerOperationStatus.TooManyChannels,
            (await RunAsync(services, s => s.CreateChannelAsync(server.OwnerId, server.ServerId, "Três"))).Status);
    }

    [Fact]
    public async Task Owner_renames_and_deletes_the_server()
    {
        await using var services = db.CreateServices();
        var server = await db.CreateServerAsync();
        var member = await db.CreateMemberAsync(server.InviteCode);

        Assert.True((await RunAsync(services, s => s.RenameServerAsync(server.OwnerId, server.ServerId, "Novo nome"))).Succeeded);
        Assert.Equal("Novo nome", (await RunAsync(services, s => s.GetServerAsync(member, server.ServerId))).Value!.Server.Name);

        var deleted = await RunAsync(services, s => s.DeleteServerAsync(server.OwnerId, server.ServerId));
        Assert.Equal([server.ChannelId], deleted.Value!.ChannelIds);
        Assert.Empty(await RunAsync(services, s => s.ListServersAsync(member)));
        Assert.Null(await RunAsync(services, s => s.GetInviteAsync(member, server.InviteCode)));
    }

    private static async Task<T> RunAsync<T>(IServiceProvider services, Func<IServerService, Task<T>> action)
    {
        await using var scope = services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IServerService>());
    }
}
