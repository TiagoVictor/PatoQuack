using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using PatoQuack.Server.Voice;

namespace PatoQuack.Server.Tests.Voice;

/// <summary>
/// Testes de integração: sobem o servidor em memória e conectam clientes SignalR reais.
/// </summary>
public sealed class VoiceHubTests(PatoQuackFactory factory)
    : IClassFixture<PatoQuackFactory>, IAsyncDisposable
{
    private readonly List<HubTestClient> _clients = [];


    [Fact]
    public async Task Join_returns_existing_participants_and_notifies_others()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");

        var anaSees = await ana.JoinAsync(_room);
        var biaSees = await bia.JoinAsync(_room);

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
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);

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
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_otherRoom);

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            bia.Connection.InvokeAsync("SendOffer", ana.Id, new SessionDescriptionDto("offer", "v=0")));

        Assert.Contains("não está na sua sala", ex.Message);
    }

    [Fact]
    public async Task Signaling_without_joining_a_room_is_rejected()
    {
        var ana = await ConnectAsync("Ana");
        var intruder = await ConnectAsync();
        await ana.JoinAsync(_room);

        await Assert.ThrowsAsync<HubException>(() =>
            intruder.Connection.InvokeAsync("SendIceCandidate", ana.Id, new IceCandidateDto("x", "0", 0, null)));
    }

    [Fact]
    public async Task Room_is_limited_to_eight_participants()
    {
        for (var i = 0; i < 8; i++)
        {
            await (await ConnectAsync($"P{i}")).JoinAsync(_room);
        }

        var ninth = await ConnectAsync("P9");
        var ex = await Assert.ThrowsAsync<HubException>(() => ninth.JoinAsync(_room));

        Assert.Contains("cheia", ex.Message);
    }

    [Fact]
    public async Task Join_requires_membership_and_an_existing_voice_channel()
    {
        await EnsureServersAsync();
        var outsider = await HubTestClient.ConnectAsync(factory, "Intruso"); // sem servidor nenhum
        _clients.Add(outsider);
        var ex = await Assert.ThrowsAsync<HubException>(() => outsider.JoinAsync(_room));
        Assert.Contains("não é membro", ex.Message);

        var member = await ConnectAsync("Ana");
        await Assert.ThrowsAsync<HubException>(() => member.JoinAsync(999_999));
    }

    [Fact]
    public async Task Hub_requires_login()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => HubTestClient.ConnectWithCookieAsync(factory, cookie: null));
        await Assert.ThrowsAnyAsync<Exception>(() => HubTestClient.ConnectWithCookieAsync(factory, "patoquack.auth=forjado"));
    }

    [Fact]
    public async Task Display_name_comes_from_the_account()
    {
        var ana = await ConnectAsync("Ana Conta");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(_room);
        var seen = await bia.JoinAsync(_room);
        Assert.Equal("Ana Conta", Assert.Single(seen).Name);
    }

    [Fact]
    public async Task Leaving_and_disconnecting_notify_the_room()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var caio = await ConnectAsync("Caio");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);
        await caio.JoinAsync(_room);

        await bia.Connection.InvokeAsync("LeaveRoom");
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
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);

        await bia.Connection.InvokeAsync("SetMuted", true);

        Assert.Equal([bia.Id, true], await ana.NextAsync("UserMuted"));
    }

    [Fact]
    public async Task StartStream_notifies_room_and_new_joiners_see_the_streamer()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);

        await ana.Connection.InvokeAsync("StartStream");

        Assert.Equal([ana.Id, "Ana"], await bia.NextAsync("StreamStarted"));
        Assert.Equal([ana.Id, "Ana"], await ana.NextAsync("StreamStarted"));

        var caio = await ConnectAsync("Caio");
        var joined = await caio.JoinWithStreamAsync(_room);
        Assert.Equal(new StreamerDto(ana.Id, "Ana"), joined.Streamer);
    }

    [Fact]
    public async Task Only_one_stream_per_room()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var other = await ConnectAsync("Outro");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);
        await other.JoinAsync(_otherRoom);

        await ana.Connection.InvokeAsync("StartStream");
        var ex = await Assert.ThrowsAsync<HubException>(() => bia.Connection.InvokeAsync("StartStream"));
        Assert.Contains("Ana já está transmitindo", ex.Message);

        // Outra sala não é afetada.
        await other.Connection.InvokeAsync("StartStream");
    }

    [Fact]
    public async Task StartStream_without_room_is_rejected()
    {
        var client = await ConnectAsync();
        await Assert.ThrowsAsync<HubException>(() => client.Connection.InvokeAsync("StartStream"));
    }

    [Fact]
    public async Task StopStream_notifies_room_and_frees_the_slot()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);

        await ana.Connection.InvokeAsync("StartStream");
        Assert.Equal([ana.Id, "Ana"], await ana.NextAsync("StreamStarted"));
        await ana.Connection.InvokeAsync("StopStream");
        Assert.Equal([ana.Id], await bia.NextAsync("StreamStopped"));

        await bia.Connection.InvokeAsync("StartStream");
        Assert.Equal([bia.Id, "Bia"], await ana.NextAsync("StreamStarted"));

        // Parar sem estar transmitindo não avisa ninguém.
        await ana.Connection.InvokeAsync("StopStream");
        var caio = await ConnectAsync("Caio");
        Assert.Equal(bia.Id, (await caio.JoinWithStreamAsync(_room)).Streamer?.ConnectionId);
    }

    [Fact]
    public async Task Leaving_or_disconnecting_ends_the_stream()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);

        await ana.Connection.InvokeAsync("StartStream");
        await ana.Connection.InvokeAsync("LeaveRoom");
        Assert.Equal([ana.Id], await bia.NextAsync("StreamStopped"));

        await bia.Connection.InvokeAsync("StartStream");
        var biaId = bia.Id;
        var caio = await ConnectAsync("Caio");
        await caio.JoinAsync(_room);
        await bia.Connection.StopAsync();
        Assert.Equal([biaId], await caio.NextAsync("StreamStopped"));

        var dani = await ConnectAsync("Dani");
        Assert.Null((await dani.JoinWithStreamAsync(_room)).Streamer);
    }

    [Fact]
    public async Task WatchStream_is_relayed_only_to_the_streamer_of_the_same_room()
    {
        var ana = await ConnectAsync("Ana");
        var bia = await ConnectAsync("Bia");
        var caio = await ConnectAsync("Caio");
        var outsider = await ConnectAsync("Outro");
        await ana.JoinAsync(_room);
        await bia.JoinAsync(_room);
        await caio.JoinAsync(_room);
        await outsider.JoinAsync(_otherRoom);

        await ana.Connection.InvokeAsync("StartStream");
        await bia.Connection.InvokeAsync("WatchStream", true);
        Assert.Equal([bia.Id, true], await ana.NextAsync("ViewerChanged"));

        // Sem efeito: outra sala (sem transmissão lá) e o próprio transmissor.
        await outsider.Connection.InvokeAsync("WatchStream", true);
        await ana.Connection.InvokeAsync("WatchStream", true);

        // O próximo aviso que a Ana recebe é o do Caio: os dois acima não chegaram.
        await caio.Connection.InvokeAsync("WatchStream", false);
        Assert.Equal([caio.Id, false], await ana.NextAsync("ViewerChanged"));
    }

    [Fact]
    public async Task WatchStream_without_stream_is_ignored_and_without_room_is_rejected()
    {
        var ana = await ConnectAsync("Ana");
        await ana.JoinAsync(_room);
        await ana.Connection.InvokeAsync("WatchStream", true); // ninguém transmite: não faz nada

        var lone = await ConnectAsync();
        await Assert.ThrowsAsync<HubException>(() => lone.Connection.InvokeAsync("WatchStream", true));
    }

    // ---- infraestrutura --------------------------------------------------

    // Cada teste tem um servidor principal (_room = canal de voz dele) e outro servidor
    // (_otherRoom), para testar isolamento entre salas. Quem conecta é membro dos dois.
    private int _room;
    private int _otherRoom;
    private int _mainServer;
    private int _otherServer;

    private async Task EnsureServersAsync()
    {
        if (_mainServer != 0) return;
        var owner = await factory.CreateUserAsync("Dono");
        (_mainServer, _room) = await factory.CreateServerAsync(owner.Id, "Principal");
        (_otherServer, _otherRoom) = await factory.CreateServerAsync(owner.Id, "Outro");
    }

    private async Task<HubTestClient> ConnectAsync(string? name = null)
    {
        await EnsureServersAsync();
        var client = await HubTestClient.ConnectAsync(factory, name, _mainServer, _otherServer);
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
}
