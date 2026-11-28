using Microsoft.AspNetCore.SignalR;
using PatoQuack.Application.Chat;
using PatoQuack.Application.Voice;

namespace PatoQuack.Server.Voice;

/// <summary>
/// Tira uma conexão do canal avisando o canal. Fica fora do hub para a API também poder tirar
/// alguém da chamada: quem sai de um servidor é removido pelo SERVIDOR (não depende do navegador
/// obedecer).
/// </summary>
public sealed class VoicePresence(
    IVoiceSessionService voice,
    IChatService chat,
    IHubContext<VoiceHub, IVoiceClient> hub,
    ILogger<VoicePresence> logger)
{
    public async Task<LeaveResult?> LeaveAsync(string connectionId)
    {
        chat.Forget(connectionId);
        var left = await voice.LeaveAsync(connectionId);
        if (left is null)
        {
            return null;
        }

        var group = VoiceHub.GroupName(left.Participant.ChannelId);

        // A transmissão (se havia) termina na mesma transação da saída; avisa antes do UserLeft.
        if (left.WasStreaming)
        {
            await hub.Clients.Group(group).StreamStopped(connectionId);
        }

        await hub.Groups.RemoveFromGroupAsync(connectionId, group);
        await hub.Clients.Group(group).UserLeft(connectionId);

        logger.LogInformation("{ConnectionId} ({Name}) saiu do canal {ChannelId}",
            connectionId, left.Participant.Name, left.Participant.ChannelId);
        return left;
    }

    /// <summary>Avisa as conexões (Kicked) e as tira dos canais.</summary>
    public async Task KickAsync(IEnumerable<string> connectionIds, string reason)
    {
        foreach (var connectionId in connectionIds)
        {
            await hub.Clients.Client(connectionId).Kicked(reason);
            await LeaveAsync(connectionId);
        }
    }
}
