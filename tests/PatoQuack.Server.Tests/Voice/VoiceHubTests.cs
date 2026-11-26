using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using PatoQuack.Server.Voice;

namespace PatoQuack.Server.Tests.Voice;

/// <summary>
/// Testes de integração: sobem o servidor em memória e conectam clientes SignalR reais.
/// </summary>
public sealed class VoiceHubTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IAsyncDisposable
{
    private readonly List<TestClient> _clients = [];

    // Cada teste usa uma sala própria, porque o registro é compartilhado pela fixture.
    private readonly string _room = $"t-{Guid.NewGuid():N}"[..20];

    [Fact]
    public async Task Join_returns_existing_participants_and_notifies_others()
    {
        var ana = await ConnectAsync();
        var bia = await ConnectAsync();

        var anaSees = await ana.JoinAsync(_room, "Ana");
        var biaSees = await bia.JoinAsync(_room, "Bia");

        Assert.Empty(anaSees);
        var existing = Assert.Single(biaSees);
        Assert.Equal(ana.Id, existing.ConnectionId);
        Assert.Equal("Ana", existing.Name);

        var joined = await ana.NextAsync("UserJoined");
        Assert.Equal([bia.Id, "Bia"], joined);
    }

    [Fact]
    public async Task Offer_answer_and_candidates_are_relayed_with_sender_id()
    {
        var ana = await ConnectAsync();
        var bia = await ConnectAsync();
        await ana.JoinAsync(_room, "Ana");
        await bia.JoinAsync(_room, "Bia");

        await bia.Connection.InvokeAsync("SendOffer", ana.Id, new SessionDescriptionDto("offer", "v=0 offer"));
        var offer = await ana.NextAsync("ReceiveOffer");
        Assert.Equal(bia.Id, offer[0]);
        Assert.Equal("v=0 offer", ((SessionDescriptionDto)offer[1]!).Sdp);

        await ana.Connection.InvokeAsync("SendAnswer", bia.Id, new SessionDescriptionDto("answer", "v=0 answer"));
        var answer = await bia.NextAsync("ReceiveAnswer");
        Assert.Equal(ana.Id, answer[0]);

        await ana.Connection.InvokeAsync("SendIceCandidate", bia.Id, new IceCandidateDto("candidate:1 1 udp 1 1.2.3.4 5 typ host", "0", 0, null));
        var ice = await bia.NextAsync("ReceiveIceCandidate");
        Assert.Equal(ana.Id, ice[0]);
        Assert.Equal("0", ((IceCandidateDto)ice[1]!).SdpMid);
    }

    [Fact]
    public async Task Signaling_to_a_connection_in_another_room_is_rejected()
    {
        var ana = await ConnectAsync();
        var bia = await ConnectAsync();
        await ana.JoinAsync(_room, "Ana");
        await bia.JoinAsync(_room + "-x", "Bia");

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            bia.Connection.InvokeAsync("SendOffer", ana.Id, new SessionDescriptionDto("offer", "v=0")));

        Assert.Contains("não está na sua sala", ex.Message);
    }

    [Fact]
    public async Task Signaling_without_joining_a_room_is_rejected()
    {
        var ana = await ConnectAsync();
        var intruder = await ConnectAsync();
        await ana.JoinAsync(_room, "Ana");

        await Assert.ThrowsAsync<HubException>(() =>
            intruder.Connection.InvokeAsync("SendIceCandidate", ana.Id, new IceCandidateDto("x", "0", 0, null)));
    }

    [Fact]
    public async Task Room_is_limited_to_six_participants()
    {
        for (var i = 0; i < 6; i++)
        {
            await (await ConnectAsync()).JoinAsync(_room, $"P{i}");
        }

        var seventh = await ConnectAsync();
        var ex = await Assert.ThrowsAsync<HubException>(() => seventh.JoinAsync(_room, "P7"));

        Assert.Contains("cheia", ex.Message);
    }

    [Theory]
    [InlineData("", "Ana")]
    [InlineData("sala com espaço", "Ana")]
    [InlineData("sala", "")]
    [InlineData("sala", "um nome muito comprido que passa de trinta e dois")]
    public async Task Invalid_input_is_rejected(string room, string name)
    {
        var client = await ConnectAsync();
        await Assert.ThrowsAsync<HubException>(() => client.JoinAsync(room, name));
    }

    [Fact]
    public async Task Leaving_and_disconnecting_notify_the_room()
    {
        var ana = await ConnectAsync();
        var bia = await ConnectAsync();
        var caio = await ConnectAsync();
        await ana.JoinAsync(_room, "Ana");
        await bia.JoinAsync(_room, "Bia");
        await caio.JoinAsync(_room, "Caio");

        await bia.Connection.InvokeAsync("LeaveRoom");
        Assert.Equal(bia.Id, (await ana.NextAsync("UserLeft"))[0]);

        var caioId = caio.Id; // ConnectionId vira null depois do StopAsync
        await caio.Connection.StopAsync();
        Assert.Equal(caioId, (await ana.NextAsync("UserLeft"))[0]);
    }

    [Fact]
    public async Task SetMuted_notifies_others()
    {
        var ana = await ConnectAsync();
        var bia = await ConnectAsync();
        await ana.JoinAsync(_room, "Ana");
        await bia.JoinAsync(_room, "Bia");

        await bia.Connection.InvokeAsync("SetMuted", true);

        Assert.Equal([bia.Id, true], await ana.NextAsync("UserMuted"));
    }

    // ---- infraestrutura --------------------------------------------------

    private async Task<TestClient> ConnectAsync()
    {
        var server = factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, VoiceHub.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
            })
            .Build();

        var client = new TestClient(connection);
        await connection.StartAsync();
        _clients.Add(client);
        return client;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var client in _clients)
        {
            await client.Connection.DisposeAsync();
        }
    }

    private sealed class TestClient
    {
        private readonly Dictionary<string, Channel<object?[]>> _events = [];

        public TestClient(HubConnection connection)
        {
            Connection = connection;
            Listen("UserJoined", typeof(string), typeof(string));
            Listen("UserLeft", typeof(string));
            Listen("UserMuted", typeof(string), typeof(bool));
            Listen("ReceiveOffer", typeof(string), typeof(SessionDescriptionDto));
            Listen("ReceiveAnswer", typeof(string), typeof(SessionDescriptionDto));
            Listen("ReceiveIceCandidate", typeof(string), typeof(IceCandidateDto));
        }

        public HubConnection Connection { get; }
        public string Id => Connection.ConnectionId!;

        public Task<List<ParticipantDto>> JoinAsync(string room, string name) =>
            Connection.InvokeAsync<List<ParticipantDto>>("JoinRoom", room, name);

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
    }
}
