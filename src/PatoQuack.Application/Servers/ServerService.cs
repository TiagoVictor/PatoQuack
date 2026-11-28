using Microsoft.Extensions.Options;
using PatoQuack.Domain.Abstractions;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Application.Servers;

public sealed class ServerService(
    IServerRepository servers,
    IServerInviteRepository invites,
    IVoiceChannelRepository channels,
    IParticipantRepository participants,
    IUnitOfWork unitOfWork,
    IOptions<ServerOptions> options,
    TimeProvider timeProvider) : IServerService
{
    // Com 31^12 códigos possíveis, colisão é raríssima; o limite só evita laço infinito.
    private const int MaxInviteCodeAttempts = 10;

    /// <summary>Opções de validade (dias) e de limite de usos (null = sem limite) de um convite.</summary>
    public static readonly IReadOnlyList<int> InviteDays = [1, 7, 30];
    public static readonly IReadOnlyList<int?> InviteMaxUses = [1, 10, null];

    public int MaxChannelsPerServer => options.Value.MaxChannelsPerServer;

    public async Task<IReadOnlyList<ServerSummary>> ListServersAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var list = await servers.ListByMemberAsync(userId, cancellationToken);
        return list.Select(s => new ServerSummary(s, ServerPermissions.For(s, userId, isMember: true))).ToList();
    }

    public async Task<ServerOperationResult<ServerDetails>> CreateServerAsync(Guid userId, string? name, CancellationToken cancellationToken = default)
    {
        if (DisplayName.Normalize(name) is not { } serverName)
        {
            return ServerOperationResult<ServerDetails>.Fail(ServerOperationStatus.InvalidName);
        }

        var now = timeProvider.GetUtcNow();
        var server = new Server(Guid.CreateVersion7(now), serverName, userId, now);
        var channel = new VoiceChannel(Guid.CreateVersion7(now), server.Id, options.Value.DefaultChannelName, now);
        // Nasce com um convite padrão, para o dono já ter um link para mandar.
        var invite = new ServerInvite(Guid.CreateVersion7(now), server.Id, await NewInviteCodeAsync(cancellationToken), userId,
            now, now.AddDays(options.Value.DefaultInviteDays), options.Value.DefaultInviteMaxUses);

        await servers.AddAsync(server, cancellationToken);
        await invites.AddAsync(invite, cancellationToken);
        await servers.AddMemberAsync(new ServerMember(server.Id, userId, now), cancellationToken);
        await channels.AddAsync(channel, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return ServerOperationResult<ServerDetails>.Ok(new ServerDetails(server, [channel], ServerPermission.All));
    }

    public async Task<ServerOperationResult<ServerDetails>> GetServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ViewChannels, cancellationToken);
        if (access.Server is not { } server)
        {
            return ServerOperationResult<ServerDetails>.Fail(access.Status);
        }

        var list = await channels.ListByServerAsync(server.Id, cancellationToken);
        return ServerOperationResult<ServerDetails>.Ok(new ServerDetails(server, list, access.Permissions));
    }

    public async Task<ServerOperationResult<Server>> RenameServerAsync(Guid userId, Guid serverId, string? name, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ManageServer, cancellationToken);
        if (access.Server is not { } server)
        {
            return ServerOperationResult<Server>.Fail(access.Status);
        }

        if (DisplayName.Normalize(name) is not { } newName)
        {
            return ServerOperationResult<Server>.Fail(ServerOperationStatus.InvalidName);
        }

        server.Rename(newName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ServerOperationResult<Server>.Ok(server);
    }

    public async Task<ServerOperationResult<DeletedChannels>> DeleteServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.DeleteServer, cancellationToken);
        if (access.Server is not { } server)
        {
            return ServerOperationResult<DeletedChannels>.Fail(access.Status);
        }

        var removed = (await channels.ListByServerAsync(server.Id, cancellationToken)).Select(c => c.Id).ToList();
        servers.Remove(server);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ServerOperationResult<DeletedChannels>.Ok(new DeletedChannels(removed));
    }

    public async Task<ServerOperationResult<VoiceChannel>> CreateChannelAsync(Guid userId, Guid serverId, string? name, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ManageChannels, cancellationToken);
        if (access.Server is not { } server)
        {
            return ServerOperationResult<VoiceChannel>.Fail(access.Status);
        }

        if (DisplayName.Normalize(name) is not { } channelName)
        {
            return ServerOperationResult<VoiceChannel>.Fail(ServerOperationStatus.InvalidName);
        }

        // Checagens sem lock: duas criações simultâneas com o mesmo nome esbarram no índice único.
        if (await channels.NameExistsAsync(server.Id, channelName, cancellationToken: cancellationToken))
        {
            return ServerOperationResult<VoiceChannel>.Fail(ServerOperationStatus.NameTaken);
        }

        var existing = await channels.ListByServerAsync(server.Id, cancellationToken);
        if (existing.Count >= MaxChannelsPerServer)
        {
            return ServerOperationResult<VoiceChannel>.Fail(ServerOperationStatus.TooManyChannels);
        }

        var now = timeProvider.GetUtcNow();
        var channel = new VoiceChannel(Guid.CreateVersion7(now), server.Id, channelName, now);
        await channels.AddAsync(channel, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return ServerOperationResult<VoiceChannel>.Ok(channel);
    }

    public async Task<ServerOperationResult<VoiceChannel>> RenameChannelAsync(Guid userId, Guid serverId, Guid channelId, string? name, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ManageChannels, cancellationToken);
        if (access.Server is null)
        {
            return ServerOperationResult<VoiceChannel>.Fail(access.Status);
        }

        var channel = await channels.GetByIdAsync(channelId, cancellationToken);
        if (channel is null || channel.ServerId != serverId)
        {
            return ServerOperationResult<VoiceChannel>.Fail(ServerOperationStatus.NotFound);
        }

        if (DisplayName.Normalize(name) is not { } newName)
        {
            return ServerOperationResult<VoiceChannel>.Fail(ServerOperationStatus.InvalidName);
        }

        if (await channels.NameExistsAsync(serverId, newName, channelId, cancellationToken))
        {
            return ServerOperationResult<VoiceChannel>.Fail(ServerOperationStatus.NameTaken);
        }

        channel.Rename(newName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ServerOperationResult<VoiceChannel>.Ok(channel);
    }

    public async Task<ServerOperationResult<DeletedChannels>> DeleteChannelAsync(Guid userId, Guid serverId, Guid channelId, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ManageChannels, cancellationToken);
        if (access.Server is null)
        {
            return ServerOperationResult<DeletedChannels>.Fail(access.Status);
        }

        var channel = await channels.GetByIdAsync(channelId, cancellationToken);
        if (channel is null || channel.ServerId != serverId)
        {
            return ServerOperationResult<DeletedChannels>.Fail(ServerOperationStatus.NotFound);
        }

        channels.Remove(channel);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ServerOperationResult<DeletedChannels>.Ok(new DeletedChannels([channelId]));
    }

    public async Task<ServerOperationResult<IReadOnlyList<ServerMemberView>>> ListMembersAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ViewMembers, cancellationToken);
        return access.Server is null
            ? ServerOperationResult<IReadOnlyList<ServerMemberView>>.Fail(access.Status)
            : ServerOperationResult<IReadOnlyList<ServerMemberView>>.Ok(await servers.ListMembersAsync(serverId, cancellationToken));
    }

    public async Task<ServerOperationResult<IReadOnlyList<string>>> LeaveServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ViewChannels, cancellationToken);
        if (access.Server is not { } server)
        {
            return ServerOperationResult<IReadOnlyList<string>>.Fail(access.Status);
        }

        if (server.IsOwner(userId))
        {
            return ServerOperationResult<IReadOnlyList<string>>.Fail(ServerOperationStatus.OwnerCannotLeave);
        }

        await servers.RemoveMemberAsync(serverId, userId, cancellationToken);
        var connections = await participants.ListConnectionsInServerAsync(userId, serverId, cancellationToken);
        return ServerOperationResult<IReadOnlyList<string>>.Ok(connections);
    }

    public async Task<ServerOperationResult<ServerInvite>> CreateInviteAsync(
        Guid userId, Guid serverId, int? expiresInDays, int? maxUses, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ManageInvites, cancellationToken);
        if (access.Server is null)
        {
            return ServerOperationResult<ServerInvite>.Fail(access.Status);
        }

        // Sem opção nenhuma: o padrão. Com validade e sem limite: sem limite de usos.
        var useDefaults = expiresInDays is null && maxUses is null;
        var days = expiresInDays ?? options.Value.DefaultInviteDays;
        var uses = useDefaults ? options.Value.DefaultInviteMaxUses : maxUses;
        if (!InviteDays.Contains(days) || !(useDefaults || InviteMaxUses.Contains(uses)))
        {
            return ServerOperationResult<ServerInvite>.Fail(ServerOperationStatus.InvalidInviteOptions);
        }

        var now = timeProvider.GetUtcNow();
        var invite = new ServerInvite(Guid.CreateVersion7(now), serverId, await NewInviteCodeAsync(cancellationToken), userId,
            now, now.AddDays(days), uses);
        await invites.AddAsync(invite, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ServerOperationResult<ServerInvite>.Ok(invite);
    }

    public async Task<ServerOperationResult<IReadOnlyList<ServerInvite>>> ListInvitesAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default)
    {
        var access = await AuthorizeAsync(userId, serverId, ServerPermission.ManageInvites, cancellationToken);
        return access.Server is null
            ? ServerOperationResult<IReadOnlyList<ServerInvite>>.Fail(access.Status)
            : ServerOperationResult<IReadOnlyList<ServerInvite>>.Ok(await invites.ListUsableAsync(serverId, timeProvider.GetUtcNow(), cancellationToken));
    }

    public async Task<ServerOperationResult<ServerInvite>> RevokeInviteAsync(Guid userId, string? inviteCode, CancellationToken cancellationToken = default)
    {
        var invite = InviteCode.Normalize(inviteCode) is { } code ? await invites.GetByCodeAsync(code, cancellationToken) : null;
        if (invite is null)
        {
            return ServerOperationResult<ServerInvite>.Fail(ServerOperationStatus.NotFound);
        }

        var access = await AuthorizeAsync(userId, invite.ServerId, ServerPermission.ManageInvites, cancellationToken);
        if (access.Server is null)
        {
            return ServerOperationResult<ServerInvite>.Fail(access.Status);
        }

        invite.Revoke(timeProvider.GetUtcNow());
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ServerOperationResult<ServerInvite>.Ok(invite);
    }

    public async Task<InvitePreview?> GetInviteAsync(Guid userId, string? inviteCode, CancellationToken cancellationToken = default)
    {
        var invite = await FindInviteAsync(inviteCode, cancellationToken);
        var server = invite is null ? null : await servers.GetByIdAsync(invite.ServerId, cancellationToken);
        if (invite is null || server is null)
        {
            return null;
        }

        var alreadyMember = await servers.IsMemberAsync(server.Id, userId, cancellationToken);
        return alreadyMember || invite.IsUsable(timeProvider.GetUtcNow())
            ? new InvitePreview(server.Id, server.Name, alreadyMember)
            : null;
    }

    public async Task<Guid?> AcceptInviteAsync(Guid userId, string? inviteCode, CancellationToken cancellationToken = default)
    {
        var invite = await FindInviteAsync(inviteCode, cancellationToken);
        if (invite is null)
        {
            return null;
        }

        // Já é membro: só leva ao servidor (mesmo com o convite esgotado; não gasta um uso).
        if (await servers.IsMemberAsync(invite.ServerId, userId, cancellationToken))
        {
            return invite.ServerId;
        }

        var now = timeProvider.GetUtcNow();
        if (!invite.IsUsable(now) || !await invites.TryConsumeUseAsync(invite.Id, now, cancellationToken))
        {
            return null;
        }

        await servers.AddMemberAsync(new ServerMember(invite.ServerId, userId, now), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return invite.ServerId;
    }

    /// <summary>
    /// Carrega o servidor e confere a permissão. Quem não é membro recebe NotFound (não revelamos
    /// que o servidor existe); membro sem permissão recebe Forbidden.
    /// </summary>
    private async Task<ServerAccess> AuthorizeAsync(Guid userId, Guid serverId, ServerPermission required, CancellationToken cancellationToken)
    {
        var server = await servers.GetByIdAsync(serverId, cancellationToken);
        if (server is null)
        {
            return ServerAccess.Denied(ServerOperationStatus.NotFound);
        }

        var isMember = server.IsOwner(userId) || await servers.IsMemberAsync(serverId, userId, cancellationToken);
        var permissions = ServerPermissions.For(server, userId, isMember);
        if (!permissions.HasFlag(ServerPermission.ViewChannels))
        {
            return ServerAccess.Denied(ServerOperationStatus.NotFound);
        }

        return permissions.HasFlag(required)
            ? new ServerAccess(ServerOperationStatus.Succeeded, server, permissions)
            : ServerAccess.Denied(ServerOperationStatus.Forbidden);
    }

    private Task<ServerInvite?> FindInviteAsync(string? inviteCode, CancellationToken cancellationToken) =>
        InviteCode.Normalize(inviteCode) is { } code
            ? invites.GetByCodeAsync(code, cancellationToken)
            : Task.FromResult<ServerInvite?>(null);

    private async Task<string> NewInviteCodeAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < MaxInviteCodeAttempts; attempt++)
        {
            var code = InviteCode.New();
            if (!await invites.CodeExistsAsync(code, cancellationToken))
            {
                return code;
            }
        }

        throw new InvalidOperationException("Não foi possível gerar um código de convite único.");
    }

    private sealed record ServerAccess(ServerOperationStatus Status, Server? Server, ServerPermission Permissions)
    {
        public static ServerAccess Denied(ServerOperationStatus status) => new(status, null, ServerPermission.None);
    }
}
