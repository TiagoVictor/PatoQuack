using Microsoft.Extensions.Options;
using PatoQuack.Domain.Abstractions;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Servers;
using PatoQuack.Domain.Users;

namespace PatoQuack.Application.Voice;

/// <summary>
/// Toda operação que muda a presença num canal segue o mesmo roteiro:
/// abre transação → trava o canal → relê o estado → decide → grava → confirma. O lock do canal
/// serializa operações concorrentes no mesmo canal sem travar os outros.
/// </summary>
public sealed class VoiceSessionService(
    IVoiceChannelRepository channels,
    IParticipantRepository participants,
    IServerRepository servers,
    IUserRepository users,
    IUnitOfWork unitOfWork,
    IOptions<VoiceOptions> options,
    TimeProvider timeProvider) : IVoiceSessionService
{
    public int MaxParticipantsPerChannel => options.Value.MaxParticipantsPerChannel;

    public async Task<JoinResult> JoinAsync(string connectionId, Guid userId, Guid channelId, CancellationToken cancellationToken = default)
    {
        if (await participants.GetByConnectionIdAsync(connectionId, cancellationToken) is not null)
        {
            return JoinResult.AlreadyInChannel;
        }

        if (await users.GetByIdAsync(userId, cancellationToken) is not { } user)
        {
            return JoinResult.NotAllowed;
        }

        await using var transaction = await unitOfWork.BeginTransactionAsync(cancellationToken);
        var channel = await channels.GetLockedAsync(channelId, cancellationToken);
        if (channel is null)
        {
            return JoinResult.NotFound;
        }

        if (!await CanConnectAsync(channel.ServerId, userId, cancellationToken))
        {
            return JoinResult.NotAllowed;
        }

        var existing = await participants.ListByChannelAsync(channelId, cancellationToken);
        if (existing.Count >= MaxParticipantsPerChannel)
        {
            return JoinResult.Full;
        }

        var self = new Participant(connectionId, userId, user.Name, channelId, timeProvider.GetUtcNow());
        await participants.AddAsync(self, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var streamer = channel.StreamerConnectionId is { } streamerId
            ? existing.FirstOrDefault(p => p.ConnectionId == streamerId)
            : null;
        return new JoinResult(JoinStatus.Joined, self, existing, streamer);
    }

    public async Task<LeaveResult?> LeaveAsync(string connectionId, CancellationToken cancellationToken = default)
    {
        await using var transaction = await unitOfWork.BeginTransactionAsync(cancellationToken);
        if (await LockPresenceAsync(connectionId, cancellationToken) is not { } locked)
        {
            return null;
        }

        var wasStreaming = locked.Channel.IsStreamer(connectionId);
        if (wasStreaming)
        {
            locked.Channel.StopStream();
        }

        participants.Remove(locked.Self);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new LeaveResult(locked.Self, wasStreaming);
    }

    public Task<Participant?> GetParticipantAsync(string connectionId, CancellationToken cancellationToken = default) =>
        participants.GetByConnectionIdAsync(connectionId, cancellationToken);

    public async Task<Participant?> GetChannelStreamerAsync(string connectionId, CancellationToken cancellationToken = default)
    {
        var self = await participants.GetByConnectionIdAsync(connectionId, cancellationToken);
        if (self is null)
        {
            return null;
        }

        var channel = await channels.GetByIdAsync(self.ChannelId, cancellationToken);
        return channel?.StreamerConnectionId is { } streamerId
            ? await participants.GetByConnectionIdAsync(streamerId, cancellationToken)
            : null;
    }

    public async Task<Participant?> SetMutedAsync(string connectionId, bool muted, CancellationToken cancellationToken = default)
    {
        await using var transaction = await unitOfWork.BeginTransactionAsync(cancellationToken);
        if (await LockPresenceAsync(connectionId, cancellationToken) is not { } locked)
        {
            return null;
        }

        locked.Self.SetMuted(muted);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return locked.Self;
    }

    public async Task<StreamStartResult> StartStreamAsync(string connectionId, CancellationToken cancellationToken = default)
    {
        await using var transaction = await unitOfWork.BeginTransactionAsync(cancellationToken);
        if (await LockPresenceAsync(connectionId, cancellationToken) is not var (self, channel))
        {
            return new StreamStartResult(StreamStartStatus.NotInChannel, null);
        }

        if (channel.StreamerConnectionId is { } currentId)
        {
            var current = currentId == connectionId
                ? self
                : await participants.GetByConnectionIdAsync(currentId, cancellationToken);
            return new StreamStartResult(StreamStartStatus.AlreadyStreaming, self, current);
        }

        channel.StartStream(connectionId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new StreamStartResult(StreamStartStatus.Started, self);
    }

    public async Task<Participant?> StopStreamAsync(string connectionId, CancellationToken cancellationToken = default)
    {
        await using var transaction = await unitOfWork.BeginTransactionAsync(cancellationToken);
        if (await LockPresenceAsync(connectionId, cancellationToken) is not var (self, channel)
            || !channel.IsStreamer(connectionId))
        {
            return null;
        }

        channel.StopStream();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return self;
    }

    public async Task ResetPresenceAsync(CancellationToken cancellationToken = default)
    {
        await participants.DeleteAllAsync(cancellationToken);
        await channels.ClearAllStreamersAsync(cancellationToken);
    }

    private async Task<bool> CanConnectAsync(Guid serverId, Guid userId, CancellationToken cancellationToken)
    {
        var server = await servers.GetByIdAsync(serverId, cancellationToken);
        if (server is null)
        {
            return false;
        }

        var isMember = server.IsOwner(userId) || await servers.IsMemberAsync(serverId, userId, cancellationToken);
        return ServerPermissions.For(server, userId, isMember).HasFlag(ServerPermission.ConnectVoice);
    }

    /// <summary>
    /// Trava o canal do participante e só então lê o participante. Ler depois do lock é o que
    /// garante que ele ainda está no canal (uma saída concorrente pode ter acabado de removê-lo).
    /// </summary>
    private async Task<LockedPresence?> LockPresenceAsync(string connectionId, CancellationToken cancellationToken)
    {
        var channel = await channels.GetLockedByParticipantAsync(connectionId, cancellationToken);
        if (channel is null)
        {
            return null;
        }

        var self = await participants.GetByConnectionIdAsync(connectionId, cancellationToken);
        return self is not null && self.ChannelId == channel.Id ? new LockedPresence(self, channel) : null;
    }
}
