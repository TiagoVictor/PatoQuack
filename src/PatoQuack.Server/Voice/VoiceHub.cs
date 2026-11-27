using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using PatoQuack.Server.Chat;
using PatoQuack.Server.Rooms;

namespace PatoQuack.Server.Voice;

/// <summary>
/// Hub de sinalização. Não transporta áudio: só repassa offer, answer e ICE candidates
/// entre clientes da mesma sala, e avisa quem entrou, saiu ou mutou.
///
/// Exige login (cookie do Identity): o nome exibido vem da conta, não do cliente.
///
/// Protocolo (malha P2P):
///   1. Cliente chama JoinRoom e recebe a lista de quem já estava na sala.
///   2. Quem ENTROU manda uma offer para cada um da lista. Quem já estava só responde.
///   3. ICE candidates são trocados nos dois sentidos até a conexão fechar.
///
/// Transmissão de vídeo: no máximo uma pessoa por sala (StartStream/StopStream). O vídeo vai
/// pelas mesmas peer connections (transceiver de vídeo criado vazio); o hub só guarda e avisa
/// quem está transmitindo. Quem quer ver chama WatchStream: o hub repassa só para quem
/// transmite (ViewerChanged), que envia vídeo apenas para quem está assistindo.
///
/// Chat de texto: SendChatMessage guarda (IChatStore) e repassa para a sala; GetChatHistory
/// devolve páginas do histórico da própria sala; Typing avisa os outros que alguém digita.
/// </summary>
[Authorize]
public sealed class VoiceHub(
    IRoomRegistry registry,
    IOptions<VoiceOptions> options,
    IChatStore chatStore,
    ChatRateLimiter chatLimiter,
    IOptions<ChatOptions> chatOptions,
    TimeProvider time,
    ILogger<VoiceHub> logger) : Hub<IVoiceClient>
{
    public const string Path = "/hubs/voice";

    private static string GroupName(string room) => $"room:{room}";

    public async Task<JoinRoomResultDto> JoinRoom(string room)
    {
        var normalizedRoom = VoiceInput.NormalizeRoom(room);
        var normalizedName = Context.User?.FindFirst(PatoQuack.Server.Auth.AppClaims.DisplayName)?.Value
                             ?? throw new HubException("Sessão inválida. Entre de novo.");
        var self = new Participant(Context.ConnectionId, normalizedName, normalizedRoom);

        if (await registry.GetAsync(Context.ConnectionId) is not null)
        {
            throw new HubException("Você já está em uma sala. Saia antes de entrar em outra.");
        }

        // Entra no grupo ANTES de aparecer no registro. Assim, qualquer pessoa que entrar
        // depois (e portanto nos vê na lista dela) já nos encontra no grupo quando mandar
        // UserJoined. Na ordem inversa, duas entradas simultâneas podiam perder esse aviso.
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(normalizedRoom));

        var result = await registry.TryJoinAsync(self, options.Value.MaxParticipantsPerRoom);
        if (result.Status != JoinStatus.Joined)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(normalizedRoom));
            throw new HubException(result.Status == JoinStatus.RoomFull
                ? $"A sala está cheia (máximo de {options.Value.MaxParticipantsPerRoom} pessoas)."
                : "Você já está em uma sala. Saia antes de entrar em outra.");
        }

        await Clients.OthersInGroup(GroupName(normalizedRoom)).UserJoined(Context.ConnectionId, normalizedName);

        logger.LogInformation("{ConnectionId} ({Name}) entrou na sala {Room} ({Count} pessoas)",
            Context.ConnectionId, normalizedName, normalizedRoom, result.ExistingParticipants.Count + 1);

        var participants = result.ExistingParticipants
            .Select(p => new ParticipantDto(p.ConnectionId, p.Name, p.Muted))
            .ToList();
        var streamer = result.Streamer is { } s ? new StreamerDto(s.ConnectionId, s.Name) : null;
        return new JoinRoomResultDto(participants, streamer);
    }

    public Task LeaveRoom() => LeaveCurrentRoomAsync();

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveCurrentRoomAsync();
        await base.OnDisconnectedAsync(exception);
    }

    public async Task SendOffer(string targetConnectionId, SessionDescriptionDto offer)
    {
        VoiceInput.ValidateDescription(offer, "offer");
        await EnsureSameRoomAsync(targetConnectionId);
        await Clients.Client(targetConnectionId).ReceiveOffer(Context.ConnectionId, offer);
    }

    public async Task SendAnswer(string targetConnectionId, SessionDescriptionDto answer)
    {
        VoiceInput.ValidateDescription(answer, "answer");
        await EnsureSameRoomAsync(targetConnectionId);
        await Clients.Client(targetConnectionId).ReceiveAnswer(Context.ConnectionId, answer);
    }

    public async Task SendIceCandidate(string targetConnectionId, IceCandidateDto candidate)
    {
        VoiceInput.ValidateCandidate(candidate);
        await EnsureSameRoomAsync(targetConnectionId);
        await Clients.Client(targetConnectionId).ReceiveIceCandidate(Context.ConnectionId, candidate);
    }

    public async Task SetMuted(bool muted)
    {
        var self = await registry.SetMutedAsync(Context.ConnectionId, muted)
                   ?? throw new HubException("Você não está em nenhuma sala.");

        await Clients.OthersInGroup(GroupName(self.Room)).UserMuted(Context.ConnectionId, muted);
    }

    public async Task StartStream()
    {
        var result = await registry.TryStartStreamAsync(Context.ConnectionId);
        switch (result.Status)
        {
            case StreamStartStatus.NotInRoom:
                throw new HubException("Você não está em nenhuma sala.");
            case StreamStartStatus.AlreadyStreaming:
                throw new HubException(result.CurrentStreamer?.ConnectionId == Context.ConnectionId
                    ? "Você já está transmitindo."
                    : $"{result.CurrentStreamer?.Name ?? "Outra pessoa"} já está transmitindo nesta sala.");
        }

        var self = result.Self!;
        await Clients.Group(GroupName(self.Room)).StreamStarted(Context.ConnectionId, self.Name);

        logger.LogInformation("{ConnectionId} ({Name}) começou a transmitir na sala {Room}",
            Context.ConnectionId, self.Name, self.Room);
    }

    public Task StopStream() => StopCurrentStreamAsync();

    /// <summary>
    /// Avisa quem transmite na sua sala que você começou ou parou de assistir. Sem transmissão
    /// (ela pode ter acabado no caminho) ou sendo você quem transmite, não faz nada.
    /// </summary>
    public async Task WatchStream(bool watching)
    {
        var self = await registry.GetAsync(Context.ConnectionId)
                   ?? throw new HubException("Você não está em nenhuma sala.");
        var streamer = await registry.GetStreamerAsync(self.Room);
        if (streamer is null || streamer.ConnectionId == Context.ConnectionId)
        {
            return;
        }

        await Clients.Client(streamer.ConnectionId).ViewerChanged(Context.ConnectionId, watching);
    }

    // ---- chat de texto ----------------------------------------------------

    public async Task<ChatMessageDto> SendChatMessage(string text)
    {
        var self = await registry.GetAsync(Context.ConnectionId)
                   ?? throw new HubException("Você não está em nenhuma sala.");
        var normalized = ChatInput.NormalizeText(text, chatOptions.Value.MaxMessageLength);
        if (!chatLimiter.TryAcquireMessage(Context.ConnectionId))
        {
            throw new HubException("Você está enviando mensagens rápido demais. Espere alguns segundos.");
        }

        var stored = await chatStore.AddAsync(self.Room, self.Name, normalized, time.GetUtcNow());
        var message = ChatMessageDto.From(stored, Context.ConnectionId);
        await Clients.Group(GroupName(self.Room)).ChatMessage(message);
        return message;
    }

    /// <summary>Uma página do histórico da sua sala: as mais recentes antes de <paramref name="beforeId"/>.</summary>
    public async Task<ChatHistoryDto> GetChatHistory(long? beforeId)
    {
        var self = await registry.GetAsync(Context.ConnectionId)
                   ?? throw new HubException("Você não está em nenhuma sala.");
        var pageSize = chatOptions.Value.HistoryPageSize;
        // Pede uma a mais só para saber se ainda há mensagens antigas.
        var page = await chatStore.GetRecentAsync(self.Room, pageSize + 1, beforeId);
        var hasMore = page.Count > pageSize;
        var messages = (hasMore ? page.Skip(1) : page).Select(m => ChatMessageDto.From(m)).ToList();
        return new ChatHistoryDto(messages, hasMore);
    }

    public async Task Typing()
    {
        var self = await registry.GetAsync(Context.ConnectionId);
        if (self is null || !chatLimiter.TryAcquireTyping(Context.ConnectionId))
        {
            return;
        }

        await Clients.OthersInGroup(GroupName(self.Room)).UserTyping(Context.ConnectionId);
    }

    private async Task StopCurrentStreamAsync()
    {
        var stopped = await registry.StopStreamAsync(Context.ConnectionId);
        if (stopped is null)
        {
            return;
        }

        await Clients.Group(GroupName(stopped.Room)).StreamStopped(Context.ConnectionId);

        logger.LogInformation("{ConnectionId} ({Name}) parou de transmitir na sala {Room}",
            Context.ConnectionId, stopped.Name, stopped.Room);
    }

    private async Task LeaveCurrentRoomAsync()
    {
        chatLimiter.Forget(Context.ConnectionId);

        // Encerra a transmissão antes de sair, para a sala receber StreamStopped.
        // (RemoveAsync também limpa o transmissor, caso um StartStream chegue no meio.)
        await StopCurrentStreamAsync();

        var removed = await registry.RemoveAsync(Context.ConnectionId);
        if (removed is null)
        {
            return;
        }

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(removed.Room));
        await Clients.Group(GroupName(removed.Room)).UserLeft(Context.ConnectionId);

        logger.LogInformation("{ConnectionId} ({Name}) saiu da sala {Room}",
            Context.ConnectionId, removed.Name, removed.Room);
    }

    /// <summary>
    /// Só permite sinalização entre conexões da mesma sala. Sem isso, qualquer cliente que
    /// descobrisse um connectionId poderia mandar offers para conexões de outras salas.
    /// </summary>
    private async Task EnsureSameRoomAsync(string targetConnectionId)
    {
        if (string.IsNullOrEmpty(targetConnectionId) || targetConnectionId == Context.ConnectionId)
        {
            throw new HubException("Destino inválido.");
        }

        var self = await registry.GetAsync(Context.ConnectionId)
                   ?? throw new HubException("Você não está em nenhuma sala.");
        var target = await registry.GetAsync(targetConnectionId);

        if (target is null || target.Room != self.Room)
        {
            throw new HubException("O destino não está na sua sala.");
        }
    }
}
