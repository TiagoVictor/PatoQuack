using Microsoft.Extensions.Options;
using PatoQuack.Domain.Abstractions;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Chat;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Application.Chat;

public sealed class ChatService(
    IParticipantRepository participants,
    IVoiceChannelRepository channels,
    IServerRepository servers,
    IChatMessageRepository messages,
    IUnitOfWork unitOfWork,
    ChatRateLimiter limiter,
    IOptions<ChatOptions> options,
    TimeProvider timeProvider) : IChatService
{
    public int MaxMessageLength => options.Value.MaxMessageLength;

    public async Task<ChatSendResult> SendAsync(string connectionId, string? text, CancellationToken cancellationToken = default)
    {
        var self = await participants.GetByConnectionIdAsync(connectionId, cancellationToken);
        if (self is null)
        {
            return new ChatSendResult(ChatSendStatus.NotInChannel);
        }

        if (!await CanAsync(self, ServerPermission.SendMessages, cancellationToken))
        {
            return new ChatSendResult(ChatSendStatus.NotAllowed);
        }

        switch (ChatText.Normalize(text, MaxMessageLength, out var normalized))
        {
            case ChatTextProblem.Empty: return new ChatSendResult(ChatSendStatus.Empty);
            case ChatTextProblem.TooLong: return new ChatSendResult(ChatSendStatus.TooLong);
            case ChatTextProblem.InvalidCharacters: return new ChatSendResult(ChatSendStatus.InvalidCharacters);
        }

        if (!limiter.TryAcquireMessage(connectionId))
        {
            return new ChatSendResult(ChatSendStatus.TooFast);
        }

        var message = new ChatMessage(self.ChannelId, self.UserId, self.Name, normalized, timeProvider.GetUtcNow());
        await messages.AddAsync(message, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new ChatSendResult(ChatSendStatus.Sent, message);
    }

    public async Task<ChatHistoryPage?> GetHistoryAsync(string connectionId, long? beforeId, CancellationToken cancellationToken = default)
    {
        var self = await participants.GetByConnectionIdAsync(connectionId, cancellationToken);
        if (self is null || !await CanAsync(self, ServerPermission.ViewChannels, cancellationToken))
        {
            return null;
        }

        var pageSize = options.Value.HistoryPageSize;
        // Pede uma a mais só para saber se ainda há mensagens antigas.
        var page = await messages.ListRecentAsync(self.ChannelId, pageSize + 1, beforeId, cancellationToken);
        var hasMore = page.Count > pageSize;
        return new ChatHistoryPage(hasMore ? page.Skip(1).ToList() : page, hasMore);
    }

    public async Task<Participant?> TryTypingAsync(string connectionId, CancellationToken cancellationToken = default)
    {
        if (!limiter.TryAcquireTyping(connectionId))
        {
            return null;
        }

        return await participants.GetByConnectionIdAsync(connectionId, cancellationToken);
    }

    public void Forget(string connectionId) => limiter.Forget(connectionId);

    public Task<int> DeleteExpiredAsync(CancellationToken cancellationToken = default)
    {
        var days = options.Value.RetentionDays;
        return days <= 0
            ? Task.FromResult(0)
            : messages.DeleteOlderThanAsync(timeProvider.GetUtcNow().AddDays(-days), cancellationToken);
    }

    private async Task<bool> CanAsync(Participant self, ServerPermission permission, CancellationToken cancellationToken)
    {
        var channel = await channels.GetByIdAsync(self.ChannelId, cancellationToken);
        var server = channel is null ? null : await servers.GetByIdAsync(channel.ServerId, cancellationToken);
        if (server is null)
        {
            return false;
        }

        var isMember = server.IsOwner(self.UserId) || await servers.IsMemberAsync(server.Id, self.UserId, cancellationToken);
        return ServerPermissions.For(server, self.UserId, isMember).HasFlag(permission);
    }
}
