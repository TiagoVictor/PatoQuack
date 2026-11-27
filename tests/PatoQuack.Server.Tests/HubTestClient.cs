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
        Listen("ReceiveOffer", typeof(string), typeof(SessionDescriptionDto));
        Listen("ReceiveAnswer", typeof(string), typeof(SessionDescriptionDto));
        Listen("ReceiveIceCandidate", typeof(string), typeof(IceCandidateDto));
    }

    public HubConnection Connection { get; }
    public string Id => Connection.ConnectionId!;

    public async Task<IReadOnlyList<ParticipantDto>> JoinAsync(string room, string name) =>
        (await JoinWithStreamAsync(room, name)).Participants;

    public Task<JoinRoomResultDto> JoinWithStreamAsync(string room, string name) =>
        Connection.InvokeAsync<JoinRoomResultDto>("JoinRoom", room, name);

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

    public static async Task<HubTestClient> ConnectAsync(WebApplicationFactory<Program> factory)
    {
        var server = factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, VoiceHub.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
            })
            .Build();

        var client = new HubTestClient(connection);
        await connection.StartAsync();
        return client;
    }
}
