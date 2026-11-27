using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using PatoQuack.Server.Chat;
using PatoQuack.Server.Voice;

namespace PatoQuack.Server.Tests;

/// <summary>Cliente SignalR real ligado ao servidor de teste, com os eventos do hub em filas.</summary>
internal sealed class HubTestClient
{
    private readonly Dictionary<string, Channel<object?[]>> _events = [];

    public HubTestClient(HubConnection connection)
    {
        Connection = connection;
        Listen("UserJoined", typeof(string), typeof(string));
        Listen("UserLeft", typeof(string));
        Listen("UserMuted", typeof(string), typeof(bool));
        Listen("StreamStarted", typeof(string), typeof(string));
        Listen("StreamStopped", typeof(string));
        Listen("ViewerChanged", typeof(string), typeof(bool));
        Listen("ChatMessage", typeof(ChatMessageDto));
        Listen("UserTyping", typeof(string));
        Listen("Kicked", typeof(string));
        Listen("ReceiveOffer", typeof(string), typeof(SessionDescriptionDto));
        Listen("ReceiveAnswer", typeof(string), typeof(SessionDescriptionDto));
        Listen("ReceiveIceCandidate", typeof(string), typeof(IceCandidateDto));
    }

    public HubConnection Connection { get; }
    public string Id => Connection.ConnectionId!;

    /// <summary>Entra no canal de voz (sala).</summary>
    public async Task<IReadOnlyList<ParticipantDto>> JoinAsync(int channelId) =>
        (await JoinWithStreamAsync(channelId)).Participants;

    public Task<JoinRoomResultDto> JoinWithStreamAsync(int channelId) =>
        Connection.InvokeAsync<JoinRoomResultDto>("JoinRoom", channelId);

    public async Task<object?[]> NextAsync(string method)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        return await _events[method].Reader.ReadAsync(timeout.Token);
    }

    private void Listen(string method, params Type[] types)
    {
        var channel = Channel.CreateUnbounded<object?[]>();
        _events[method] = channel;
        Connection.On(method, types, args =>
        {
            channel.Writer.TryWrite(args);
            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// Cria uma conta com esse nome, membro dos servidores indicados, faz login e conecta ao hub
    /// com o cookie da sessão.
    /// </summary>
    public static async Task<HubTestClient> ConnectAsync(PatoQuackFactory factory, string? displayName = null, params int[] memberOf)
    {
        var user = await factory.CreateUserAsync(displayName ?? $"P{Guid.NewGuid():N}"[..8]);
        foreach (var serverId in memberOf)
        {
            await factory.AddMemberAsync(serverId, user.Id);
        }

        var cookie = await factory.LoginCookieAsync(user.Email!);
        return await ConnectWithCookieAsync(factory, cookie);
    }

    /// <summary>Conecta com um cabeçalho Cookie qualquer (null = sem login).</summary>
    public static async Task<HubTestClient> ConnectWithCookieAsync(WebApplicationFactory<Program> factory, string? cookie)
    {
        var server = factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, VoiceHub.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
                if (cookie is not null) options.Headers["Cookie"] = cookie;
            })
            .Build();

        var client = new HubTestClient(connection);
        await connection.StartAsync();
        return client;
    }
}
