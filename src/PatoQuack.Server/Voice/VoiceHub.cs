using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using PatoQuack.Application.Chat;
using PatoQuack.Application.Voice;
using PatoQuack.Domain.Chat;
using PatoQuack.Server.Auth;

namespace PatoQuack.Server.Voice;

/// <summary>
/// Hub de sinalização. Não transporta áudio: só repassa offer, answer e ICE candidates
/// entre clientes do mesmo canal de voz, e avisa quem entrou, saiu ou mutou.
///
/// Protocolo (malha P2P):
///   1. Cliente chama JoinChannel e recebe a lista de quem já estava no canal.
///   2. Quem ENTROU manda uma offer para cada um da lista. Quem já estava só responde.
///   3. ICE candidates são trocados nos dois sentidos até a conexão fechar.
///
/// Transmissão de vídeo: no máximo uma pessoa por canal (StartStream/StopStream). O vídeo vai
/// pelas mesmas peer connections (transceiver de vídeo criado vazio); o hub só guarda e avisa
/// quem está transmitindo.
///
/// Assistir sob demanda: quem quer ver chama WatchStream; o hub avisa só quem transmite
/// (ViewerChanged), que envia (e codifica) vídeo apenas para quem está assistindo.
///
/// Chat de texto: SendChatMessage grava e repassa ao canal; GetChatHistory devolve páginas do
/// histórico do próprio canal; Typing avisa os outros que alguém digita.
///
/// Exige login (cookie da sessão). O nome exibido é o do usuário logado, e só membros do servidor
/// entram nos canais dele.
///
/// Servidores e canais são criados pela API REST (/api/servers). Este hub é um adaptador de
/// entrada: valida a entrada, chama o <see cref="IVoiceSessionService"/> e traduz o resultado em
/// eventos SignalR. Não conhece banco de dados.
/// </summary>
[Authorize]
public sealed class VoiceHub(
    IVoiceSessionService voice,
    IChatService chat,
    VoicePresence presence,
    ILogger<VoiceHub> logger) : Hub<IVoiceClient>
{
    public const string Path = "/hubs/voice";

    /// <summary>Grupo SignalR de um canal (usado também pela API para avisar canais apagados).</summary>
    public static string GroupName(Guid channelId) => $"channel:{channelId:N}";

    public async Task<JoinChannelResultDto> JoinChannel(string channelId)
    {
        var id = VoiceInput.ParseChannelId(channelId);
        var userId = Context.User!.GetUserId();
        var aborted = Context.ConnectionAborted;

        if (await voice.GetParticipantAsync(Context.ConnectionId, aborted) is not null)
        {
            throw new HubException("Você já está em um canal. Saia antes de entrar em outro.");
        }

        // Entra no grupo ANTES de aparecer na presença. Assim, qualquer pessoa que entrar
        // depois (e portanto nos vê na lista dela) já nos encontra no grupo quando mandar
        // UserJoined. Na ordem inversa, duas entradas simultâneas podiam perder esse aviso.
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(id));

        var result = await voice.JoinAsync(Context.ConnectionId, userId, id, aborted);
        if (result.Status != JoinStatus.Joined)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(id));
            throw new HubException(result.Status switch
            {
                JoinStatus.ChannelNotFound or JoinStatus.NotAllowed => "Canal não encontrado.",
                JoinStatus.ChannelFull => $"O canal está cheio (máximo de {voice.MaxParticipantsPerChannel} pessoas).",
                _ => "Você já está em um canal. Saia antes de entrar em outro.",
            });
        }

        var self = result.Self!;
        await Clients.OthersInGroup(GroupName(id)).UserJoined(Context.ConnectionId, self.Name);

        logger.LogInformation("{ConnectionId} ({Name}) entrou no canal {ChannelId} ({Count} pessoas)",
            Context.ConnectionId, self.Name, id, result.ExistingParticipants.Count + 1);

        var participants = result.ExistingParticipants
            .Select(p => new ParticipantDto(p.ConnectionId, p.Name, p.Muted))
            .ToList();
        var streamer = result.Streamer is { } s ? new StreamerDto(s.ConnectionId, s.Name) : null;
        return new JoinChannelResultDto(participants, streamer);
    }

    public Task LeaveChannel() => LeaveCurrentChannelAsync();

    /// <summary>
    /// Avisa quem transmite no seu canal que você começou ou parou de assistir. Sem transmissão (pode
    /// ter acabado no caminho) ou sendo você quem transmite, não faz nada.
    /// </summary>
    public async Task WatchStream(bool watching)
    {
        if (await voice.GetParticipantAsync(Context.ConnectionId, Context.ConnectionAborted) is null)
        {
            throw new HubException("Você não está em nenhum canal.");
        }

        var streamer = await voice.GetChannelStreamerAsync(Context.ConnectionId, Context.ConnectionAborted);
        if (streamer is null || streamer.ConnectionId == Context.ConnectionId)
        {
            return;
        }

        await Clients.Client(streamer.ConnectionId).ViewerChanged(Context.ConnectionId, watching);
    }

    // ---- chat de texto ----------------------------------------------------

    public async Task<ChatMessageDto> SendChatMessage(string text)
    {
        var result = await chat.SendAsync(Context.ConnectionId, text, Context.ConnectionAborted);
        if (result.Status != ChatSendStatus.Sent)
        {
            throw new HubException(result.Status switch
            {
                ChatSendStatus.NotInChannel => "Você não está em nenhum canal.",
                ChatSendStatus.NotAllowed => "Você não é mais membro deste servidor.",
                ChatSendStatus.Empty => "A mensagem está vazia.",
                ChatSendStatus.TooLong => $"A mensagem passou de {chat.MaxMessageLength} caracteres.",
                ChatSendStatus.InvalidCharacters => "A mensagem tem caracteres inválidos.",
                _ => "Você está enviando mensagens rápido demais. Espere alguns segundos.",
            });
        }

        var message = ToDto(result.Message!, Context.ConnectionId);
        await Clients.Group(GroupName(result.Message!.ChannelId)).ChatMessage(message);
        return message;
    }

    /// <summary>Uma página do histórico do seu canal: as mais recentes antes de <paramref name="beforeId"/>.</summary>
    public async Task<ChatHistoryDto> GetChatHistory(long? beforeId)
    {
        var page = await chat.GetHistoryAsync(Context.ConnectionId, beforeId, Context.ConnectionAborted)
                   ?? throw new HubException("Você não está em nenhum canal.");
        return new ChatHistoryDto(page.Messages.Select(m => ToDto(m, null)).ToList(), page.HasMore);
    }

    public async Task Typing()
    {
        var self = await chat.TryTypingAsync(Context.ConnectionId, Context.ConnectionAborted);
        if (self is not null)
        {
            await Clients.OthersInGroup(GroupName(self.ChannelId)).UserTyping(Context.ConnectionId);
        }
    }

    private static ChatMessageDto ToDto(ChatMessage message, string? authorConnectionId) =>
        new(message.Id, message.AuthorName, message.Text, message.SentAt, authorConnectionId);

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveCurrentChannelAsync();
        await base.OnDisconnectedAsync(exception);
    }

    public async Task SendOffer(string targetConnectionId, SessionDescriptionDto offer)
    {
        VoiceInput.ValidateDescription(offer, "offer");
        await EnsureSameChannelAsync(targetConnectionId);
        await Clients.Client(targetConnectionId).ReceiveOffer(Context.ConnectionId, offer);
    }

    public async Task SendAnswer(string targetConnectionId, SessionDescriptionDto answer)
    {
        VoiceInput.ValidateDescription(answer, "answer");
        await EnsureSameChannelAsync(targetConnectionId);
        await Clients.Client(targetConnectionId).ReceiveAnswer(Context.ConnectionId, answer);
    }

    public async Task SendIceCandidate(string targetConnectionId, IceCandidateDto candidate)
    {
        VoiceInput.ValidateCandidate(candidate);
        await EnsureSameChannelAsync(targetConnectionId);
        await Clients.Client(targetConnectionId).ReceiveIceCandidate(Context.ConnectionId, candidate);
    }

    public async Task SetMuted(bool muted)
    {
        var self = await voice.SetMutedAsync(Context.ConnectionId, muted, Context.ConnectionAborted)
                   ?? throw new HubException("Você não está em nenhum canal.");

        await Clients.OthersInGroup(GroupName(self.ChannelId)).UserMuted(Context.ConnectionId, muted);
    }

    public async Task StartStream()
    {
        var result = await voice.StartStreamAsync(Context.ConnectionId, Context.ConnectionAborted);
        switch (result.Status)
        {
            case StreamStartStatus.NotInChannel:
                throw new HubException("Você não está em nenhum canal.");
            case StreamStartStatus.AlreadyStreaming:
                throw new HubException(result.CurrentStreamer?.ConnectionId == Context.ConnectionId
                    ? "Você já está transmitindo."
                    : $"{result.CurrentStreamer?.Name ?? "Outra pessoa"} já está transmitindo neste canal.");
        }

        var self = result.Self!;
        await Clients.Group(GroupName(self.ChannelId)).StreamStarted(Context.ConnectionId, self.Name);

        logger.LogInformation("{ConnectionId} ({Name}) começou a transmitir no canal {ChannelId}",
            Context.ConnectionId, self.Name, self.ChannelId);
    }

    public async Task StopStream()
    {
        var stopped = await voice.StopStreamAsync(Context.ConnectionId, Context.ConnectionAborted);
        if (stopped is null)
        {
            return;
        }

        await Clients.Group(GroupName(stopped.ChannelId)).StreamStopped(Context.ConnectionId);

        logger.LogInformation("{ConnectionId} ({Name}) parou de transmitir no canal {ChannelId}",
            Context.ConnectionId, stopped.Name, stopped.ChannelId);
    }

    private Task LeaveCurrentChannelAsync() => presence.LeaveAsync(Context.ConnectionId);

    /// <summary>
    /// Só permite sinalização entre conexões do mesmo canal. Sem isso, qualquer cliente que
    /// descobrisse um connectionId poderia mandar offers para conexões de outros canais.
    /// </summary>
    private async Task EnsureSameChannelAsync(string targetConnectionId)
    {
        if (string.IsNullOrEmpty(targetConnectionId) || targetConnectionId == Context.ConnectionId)
        {
            throw new HubException("Destino inválido.");
        }

        var self = await voice.GetParticipantAsync(Context.ConnectionId, Context.ConnectionAborted)
                   ?? throw new HubException("Você não está em nenhum canal.");
        var target = await voice.GetParticipantAsync(targetConnectionId, Context.ConnectionAborted);

        if (target is null || target.ChannelId != self.ChannelId)
        {
            throw new HubException("O destino não está no seu canal.");
        }
    }
}
