using System.Net.Http.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using PatoQuack.Server.Api;
using PatoQuack.Server.Tests.Infrastructure;
using PatoQuack.Server.Voice;

namespace PatoQuack.Server.Tests.Voice;

/// <summary>
/// Testes de integração: sobem o servidor em memória (com PostgreSQL no Docker) e conectam
/// clientes SignalR reais, cada um logado como um usuário (cookie de sessão).
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class VoiceHubTests(PostgresFixture db) : IAsyncDisposable
{
    private readonly List<TestClient> _clients = [];
    private TestSession? _owner;
    private ServerDto? _server;
    private string? _invite;

    [Fact]
    public async Task Join_returns_existing_participants_with_user_names_and_notifies_others()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");

        var anaSees = await ana.JoinAsync(await ChannelAsync());
        var biaSees = await bia.JoinAsync(await ChannelAsync());

        Assert.Empty(anaSees);
        var existing = Assert.Single(biaSees);
        Assert.Equal(ana.Id, existing.ConnectionId);
        Assert.Equal("Ana", existing.Name);

        Assert.Equal([bia.Id, "Bia"], await ana.NextAsync("UserJoined"));
    }

    [Fact]
    public async Task Connecting_without_login_is_rejected()
    {
        var server = db.Factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, VoiceHub.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
            })
            .Build();

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => connection.StartAsync());
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, ex.StatusCode);
    }

    [Fact]
    public async Task Non_members_cannot_join_the_channel()
    {
        var stranger = await ConnectAsync("Estranho", joinServer: false);

        var ex = await Assert.ThrowsAsync<HubException>(async () => await stranger.JoinAsync(await ChannelAsync()));

        Assert.Contains("Canal não encontrado", ex.Message);
    }

    [Fact]
    public async Task Offer_answer_and_candidates_are_relayed_with_sender_id()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());

        await bia.Connection.InvokeAsync("SendOffer", ana.Id, new SessionDescriptionDto("offer", "v=0 offer"));
        var offer = await ana.NextAsync("ReceiveOffer");
        Assert.Equal(bia.Id, offer[0]);
        Assert.Equal("v=0 offer", ((SessionDescriptionDto)offer[1]!).Sdp);

        await ana.Connection.InvokeAsync("SendAnswer", bia.Id, new SessionDescriptionDto("answer", "v=0 answer"));
        Assert.Equal(ana.Id, (await bia.NextAsync("ReceiveAnswer"))[0]);

        await ana.Connection.InvokeAsync("SendIceCandidate", bia.Id, new IceCandidateDto("candidate:1 1 udp 1 1.2.3.4 5 typ host", "0", 0, null));
        var ice = await bia.NextAsync("ReceiveIceCandidate");
        Assert.Equal(ana.Id, ice[0]);
        Assert.Equal("0", ((IceCandidateDto)ice[1]!).SdpMid);
    }

    [Fact]
    public async Task Signaling_to_a_connection_in_another_channel_is_rejected()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await OtherChannelAsync());

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            bia.Connection.InvokeAsync("SendOffer", ana.Id, new SessionDescriptionDto("offer", "v=0")));

        Assert.Contains("não está no seu canal", ex.Message);
    }

    [Fact]
    public async Task Signaling_without_joining_a_channel_is_rejected()
    {
        var ana = await ConnectAsync("Ana");
        var intruder = await ConnectAsync("Intruso");
        await ana.JoinAsync(await ChannelAsync());

        await Assert.ThrowsAsync<HubException>(() =>
            intruder.Connection.InvokeAsync("SendIceCandidate", ana.Id, new IceCandidateDto("x", "0", 0, null)));
    }

    [Fact]
    public async Task Channel_is_limited_to_eight_participants()
    {
        for (var i = 0; i < 8; i++)
        {
            await (await ConnectAsync($"P{i}")).JoinAsync(await ChannelAsync());
        }

        var seventh = await ConnectAsync("P9");
        var channel = await ChannelAsync();
        var ex = await Assert.ThrowsAsync<HubException>(() => seventh.JoinAsync(channel));

        Assert.Contains("cheio", ex.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData("nao-e-guid")]
    public async Task Invalid_channel_id_is_rejected(string channelId)
    {
        var client = await ConnectAsync("Ana");
        await Assert.ThrowsAsync<HubException>(() => client.JoinAsync(channelId));
    }

    [Fact]
    public async Task Joining_an_unknown_channel_is_rejected()
    {
        var client = await ConnectAsync("Ana");
        var ex = await Assert.ThrowsAsync<HubException>(() => client.JoinAsync(Guid.NewGuid().ToString()));
        Assert.Contains("Canal não encontrado", ex.Message);
    }

    [Fact]
    public async Task Leaving_and_disconnecting_notify_the_channel()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var caio = await ConnectAsync("Caio");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());
        await caio.JoinAsync(await ChannelAsync());

        await bia.Connection.InvokeAsync("LeaveChannel");
        Assert.Equal(bia.Id, (await ana.NextAsync("UserLeft"))[0]);

        var caioId = caio.Id; // ConnectionId vira null depois do StopAsync
        await caio.Connection.StopAsync();
        Assert.Equal(caioId, (await ana.NextAsync("UserLeft"))[0]);
    }

    [Fact]
    public async Task SetMuted_notifies_others()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());

        await bia.Connection.InvokeAsync("SetMuted", true);

        Assert.Equal([bia.Id, true], await ana.NextAsync("UserMuted"));
    }

    [Fact]
    public async Task StartStream_notifies_channel_and_new_joiners_see_the_streamer()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());

        await ana.Connection.InvokeAsync("StartStream");

        Assert.Equal([ana.Id, "Ana"], await bia.NextAsync("StreamStarted"));
        Assert.Equal([ana.Id, "Ana"], await ana.NextAsync("StreamStarted"));

        var caio = await ConnectAsync("Caio");
        var joined = await caio.JoinWithStreamAsync(await ChannelAsync());
        Assert.Equal(new StreamerDto(ana.Id, "Ana"), joined.Streamer);
    }

    [Fact]
    public async Task Only_one_stream_per_channel()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var other = await ConnectAsync("Outro");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());
        await other.JoinAsync(await OtherChannelAsync());

        await ana.Connection.InvokeAsync("StartStream");
        var ex = await Assert.ThrowsAsync<HubException>(() => bia.Connection.InvokeAsync("StartStream"));
        Assert.Contains("Ana já está transmitindo", ex.Message);

        // Outro canal não é afetado.
        await other.Connection.InvokeAsync("StartStream");
    }

    [Fact]
    public async Task StartStream_without_channel_is_rejected()
    {
        var client = await ConnectAsync("Ana");
        await Assert.ThrowsAsync<HubException>(() => client.Connection.InvokeAsync("StartStream"));
    }

    [Fact]
    public async Task StopStream_notifies_channel_and_frees_the_slot()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());

        await ana.Connection.InvokeAsync("StartStream");
        Assert.Equal([ana.Id, "Ana"], await ana.NextAsync("StreamStarted"));
        await ana.Connection.InvokeAsync("StopStream");
        Assert.Equal([ana.Id], await bia.NextAsync("StreamStopped"));

        await bia.Connection.InvokeAsync("StartStream");
        Assert.Equal([bia.Id, "Bia"], await ana.NextAsync("StreamStarted"));

        // Parar sem estar transmitindo não avisa ninguém.
        await ana.Connection.InvokeAsync("StopStream");
        var caio = await ConnectAsync("Caio");
        Assert.Equal(bia.Id, (await caio.JoinWithStreamAsync(await ChannelAsync())).Streamer?.ConnectionId);
    }

    [Fact]
    public async Task Leaving_or_disconnecting_ends_the_stream()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());

        await ana.Connection.InvokeAsync("StartStream");
        await ana.Connection.InvokeAsync("LeaveChannel");
        Assert.Equal([ana.Id], await bia.NextAsync("StreamStopped"));

        await bia.Connection.InvokeAsync("StartStream");
        var biaId = bia.Id;
        var caio = await ConnectAsync("Caio");
        await caio.JoinAsync(await ChannelAsync());
        await bia.Connection.StopAsync();
        Assert.Equal([biaId], await caio.NextAsync("StreamStopped"));

        var dani = await ConnectAsync("Dani");
        Assert.Null((await dani.JoinWithStreamAsync(await ChannelAsync())).Streamer);
    }

    [Fact]
    public async Task Watching_is_announced_only_to_the_streamer()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var caio = await ConnectAsync("Caio");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());
        await caio.JoinAsync(await ChannelAsync());

        // Sem transmissão, assistir não avisa ninguém.
        await bia.Connection.InvokeAsync("WatchStream", true);

        await ana.Connection.InvokeAsync("StartStream");
        await bia.Connection.InvokeAsync("WatchStream", true);
        Assert.Equal([bia.Id, true], await ana.NextAsync("ViewerChanged"));
        await bia.Connection.InvokeAsync("WatchStream", false);
        Assert.Equal([bia.Id, false], await ana.NextAsync("ViewerChanged"));

        Assert.False(caio.HasPending("ViewerChanged"));
        Assert.False(bia.HasPending("ViewerChanged"));
    }

    [Fact]
    public async Task Chat_messages_reach_the_channel_and_build_the_history()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var other = await ConnectAsync("Outro");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());
        await other.JoinAsync(await OtherChannelAsync());

        var sent = await ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "  oi\r\nbia  ");
        Assert.Equal("oi\nbia", sent.Text);
        Assert.Equal("Ana", sent.AuthorName);
        Assert.Equal(ana.Id, sent.AuthorConnectionId);

        var received = (ChatMessageDto)(await bia.NextAsync("ChatMessage"))[0]!;
        Assert.Equal(sent.Id, received.Id);
        Assert.False(other.HasPending("ChatMessage"));

        await bia.Connection.InvokeAsync("Typing");
        Assert.Equal([bia.Id], await ana.NextAsync("UserTyping"));

        // Quem entra depois vê o histórico (sem connectionId do autor).
        var caio = await ConnectAsync("Caio");
        await caio.JoinAsync(await ChannelAsync());
        var history = await caio.Connection.InvokeAsync<ChatHistoryDto>("GetChatHistory", (long?)null);
        var message = Assert.Single(history.Messages);
        Assert.Equal(("oi\nbia", (string?)null), (message.Text, message.AuthorConnectionId));
        Assert.False(history.HasMore);
    }

    [Fact]
    public async Task Chat_validates_text_and_limits_the_rate()
    {
        var ana = await ConnectAsync("Ana");
        await ana.JoinAsync(await ChannelAsync());

        await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "   "));
        await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", new string('a', 2001)));
        await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "a\u0007b"));

        for (var i = 0; i < 5; i++)
        {
            await ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", $"m{i}");
        }

        var ex = await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "m6"));
        Assert.Contains("rápido demais", ex.Message);
    }

    [Fact]
    public async Task Chat_requires_being_in_a_channel()
    {
        var ana = await ConnectAsync("Ana");
        await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "oi"));
        await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatHistoryDto>("GetChatHistory", (long?)null));
    }

    [Fact]
    public async Task Leaving_the_server_kicks_from_the_call_and_blocks_the_chat()
    {
        var ana = await ConnectAsync("Ana");
        var (bia, biaSession) = await ConnectWithSessionAsync("Bia");
        await ana.JoinAsync(await ChannelAsync());
        await bia.JoinAsync(await ChannelAsync());
        var biaId = bia.Id;

        (await biaSession.Client.PostAsync($"/api/servers/{_server!.Id}/leave", null)).EnsureSuccessStatusCode();

        Assert.Equal(["Você saiu do servidor."], await bia.NextAsync("Kicked"));
        Assert.Equal([biaId], await ana.NextAsync("UserLeft"));
        await Assert.ThrowsAsync<HubException>(() => bia.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "oi"));
    }

    [Fact]
    public async Task Deleting_a_channel_notifies_who_is_in_it()
    {
        var ana = await ConnectAsync("Ana");
        var channel = await ChannelAsync();
        await ana.JoinAsync(channel);

        var response = await _owner!.Client.DeleteAsync($"/api/servers/{_server!.Id}/channels/{channel}");
        response.EnsureSuccessStatusCode();

        Assert.Equal([channel], await ana.NextAsync("ChannelDeleted"));
    }

    // ---- infraestrutura --------------------------------------------------

    /// <summary>Canal padrão de um servidor criado por um dono próprio do teste.</summary>
    private async Task<string> ChannelAsync() => (await ServerAsync()).Channels[0].Id.ToString();

    private async Task<string> OtherChannelAsync()
    {
        var server = await ServerAsync();
        var response = await _owner!.Client.PostAsJsonAsync($"/api/servers/{server.Id}/channels", new NameRequest($"c{Guid.NewGuid():N}"[..10]));
        return (await response.Content.ReadFromJsonAsync<ChannelDto>())!.Id.ToString();
    }

    private async Task<ServerDto> ServerAsync()
    {
        if (_server is null)
        {
            _owner = await db.RegisterSessionAsync("Dono");
            var response = await _owner.Client.PostAsJsonAsync("/api/servers", new NameRequest("Servidor"));
            _server = (await response.Content.ReadFromJsonAsync<ServerDto>())!;
            // Convite sem limite de usos: alguns testes põem muita gente no servidor.
            var invite = await _owner.Client.PostAsJsonAsync($"/api/servers/{_server.Id}/invites", new CreateInviteRequest(30, null));
            _invite = (await invite.Content.ReadFromJsonAsync<ServerInviteDto>())!.Code;
        }

        return _server;
    }

    /// <summary>Cadastra um usuário com esse nome, entra no servidor (por convite) e conecta no hub com o cookie dele.</summary>
    private async Task<TestClient> ConnectAsync(string name, bool joinServer = true) =>
        (await ConnectWithSessionAsync(name, joinServer)).Client;

    private async Task<(TestClient Client, TestSession Session)> ConnectWithSessionAsync(string name, bool joinServer = true)
    {
        var session = await db.RegisterSessionAsync(name);
        if (joinServer)
        {
            var server = await ServerAsync();
            (await session.Client.PostAsync($"/api/invites/{_invite}/accept", null)).EnsureSuccessStatusCode();
        }

        var testServer = db.Factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(testServer.BaseAddress, VoiceHub.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => testServer.CreateHandler();
                options.Headers["Cookie"] = session.Cookie;
            })
            .Build();

        var client = new TestClient(connection);
        await connection.StartAsync();
        _clients.Add(client);
        return (client, session);
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
            Listen("StreamStarted", typeof(string), typeof(string));
            Listen("StreamStopped", typeof(string));
            Listen("ChannelDeleted", typeof(string));
            Listen("Kicked", typeof(string));
            Listen("ViewerChanged", typeof(string), typeof(bool));
            Listen("ChatMessage", typeof(ChatMessageDto));
            Listen("UserTyping", typeof(string));
            Listen("ReceiveOffer", typeof(string), typeof(SessionDescriptionDto));
            Listen("ReceiveAnswer", typeof(string), typeof(SessionDescriptionDto));
            Listen("ReceiveIceCandidate", typeof(string), typeof(IceCandidateDto));
        }

        public HubConnection Connection { get; }
        public string Id => Connection.ConnectionId!;

        public async Task<IReadOnlyList<ParticipantDto>> JoinAsync(string channelId) =>
            (await JoinWithStreamAsync(channelId)).Participants;

        public Task<JoinChannelResultDto> JoinWithStreamAsync(string channelId) =>
            Connection.InvokeAsync<JoinChannelResultDto>("JoinChannel", channelId);

        public async Task<object?[]> NextAsync(string method)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            return await _events[method].Reader.ReadAsync(timeout.Token);
        }

        /// <summary>Chegou algum evento desse tipo ainda não lido? (Espera um pouco antes de responder.)</summary>
        public bool HasPending(string method)
        {
            Thread.Sleep(200);
            return _events[method].Reader.TryPeek(out _);
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
