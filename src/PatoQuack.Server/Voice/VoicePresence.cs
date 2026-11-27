using Microsoft.AspNetCore.SignalR;
using PatoQuack.Server.Chat;
using PatoQuack.Server.Rooms;

namespace PatoQuack.Server.Voice;

/// <summary>
/// Sair da sala (e parar a transmissão) avisando a sala. Fica fora do hub para que as rotas da API
/// também possam tirar alguém da chamada: quem sai de um servidor, ou quando o servidor é apagado,
/// é removido pelo SERVIDOR (não depende do navegador obedecer).
/// </summary>
public sealed class VoicePresence(
    IRoomRegistry registry,
    IHubContext<VoiceHub, IVoiceClient> hub,
    ChatRateLimiter chatLimiter,
    ILogger<VoicePresence> logger)
{
    public static string GroupName(string room) => $"room:{room}";

    public async Task StopStreamAsync(string connectionId)
    {
        var stopped = await registry.StopStreamAsync(connectionId);
        if (stopped is null)
        {
            return;
        }

        await hub.Clients.Group(GroupName(stopped.Room)).StreamStopped(connectionId);
        logger.LogInformation("{ConnectionId} ({Name}) parou de transmitir na sala {Room}", connectionId, stopped.Name, stopped.Room);
    }

    public async Task LeaveAsync(string connectionId)
    {
        chatLimiter.Forget(connectionId);
        // Encerra a transmissão antes de sair, para a sala receber StreamStopped.
        // (RemoveAsync também limpa o transmissor, caso um StartStream chegue no meio.)
        await StopStreamAsync(connectionId);

        var removed = await registry.RemoveAsync(connectionId);
        if (removed is null)
        {
            return;
        }

        await hub.Groups.RemoveFromGroupAsync(connectionId, GroupName(removed.Room));
        await hub.Clients.Group(GroupName(removed.Room)).UserLeft(connectionId);
        logger.LogInformation("{ConnectionId} ({Name}) saiu da sala {Room}", connectionId, removed.Name, removed.Room);
    }

    /// <summary>Tira a conta das salas indicadas (ex.: canais de um servidor do qual ela saiu).</summary>
    public async Task EvictUserAsync(string userId, IReadOnlyCollection<string> rooms, string reason)
    {
        foreach (var p in await registry.GetByUserAsync(userId))
        {
            if (rooms.Contains(p.Room))
            {
                await KickAsync(p, reason);
            }
        }
    }

    /// <summary>Tira todo mundo das salas (ex.: o servidor foi apagado).</summary>
    public async Task EvictRoomsAsync(IEnumerable<string> rooms, string reason)
    {
        foreach (var room in rooms)
        {
            foreach (var p in await registry.GetParticipantsAsync(room))
            {
                await KickAsync(p, reason);
            }
        }
    }

    private async Task KickAsync(Participant p, string reason)
    {
        await hub.Clients.Client(p.ConnectionId).Kicked(reason);
        await LeaveAsync(p.ConnectionId);
    }
}
