using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Server.Chat;

namespace PatoQuack.Server.Tests.Chat;

/// <summary>Chat de texto pelo hub: repasse, histórico, validação, limite e "digitando".</summary>
public sealed class ChatHubTests(PatoQuackFactory factory) : IClassFixture<PatoQuackFactory>, IAsyncDisposable
{
    private readonly List<HubTestClient> _clients = [];
    private readonly string _room = $"c-{Guid.NewGuid():N}"[..20];

    [Fact]
    public async Task Message_is_normalized_stored_and_relayed_only_to_the_same_room()
    {
        var ana = await JoinAsync("Ana");
        var bia = await JoinAsync("Bia");
        var outsider = await ConnectAsync("Outro");
        await outsider.JoinAsync(_room + "-x");

        var sent = await ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "  olá\r\nmundo  ");
        Assert.Equal("olá\nmundo", sent.Text);
        Assert.Equal("Ana", sent.AuthorName);
        Assert.Equal(ana.Id, sent.AuthorConnectionId);

        var received = (ChatMessageDto)(await bia.NextAsync("ChatMessage"))[0]!;
        Assert.Equal(sent, received);
        Assert.Equal(sent, (ChatMessageDto)(await ana.NextAsync("ChatMessage"))[0]!); // quem envia também recebe

        // Mensagem de outra sala não chega: a próxima que a Bia recebe é a dela mesma.
        await outsider.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "outra sala");
        await bia.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "segunda");
        Assert.Equal("segunda", ((ChatMessageDto)(await bia.NextAsync("ChatMessage"))[0]!).Text);
    }

    [Fact]
    public async Task History_is_paged_newest_first_per_room_without_connection_ids()
    {
        using var scope = factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IChatStore>();
        var start = DateTimeOffset.UtcNow.AddMinutes(-10);
        for (var i = 1; i <= 120; i++)
        {
            await store.AddAsync(_room, "Ana", $"m{i}", start.AddSeconds(i));
        }
        await store.AddAsync(_room + "-x", "Outro", "não é desta sala", start);

        var caio = await JoinAsync("Caio");
        var first = await caio.Connection.InvokeAsync<ChatHistoryDto>("GetChatHistory", (long?)null);
        Assert.True(first.HasMore);
        Assert.Equal(Enumerable.Range(71, 50).Select(i => $"m{i}"), first.Messages.Select(m => m.Text));
        Assert.All(first.Messages, m => Assert.Null(m.AuthorConnectionId));

        var second = await caio.Connection.InvokeAsync<ChatHistoryDto>("GetChatHistory", (long?)first.Messages[0].Id);
        Assert.True(second.HasMore);
        Assert.Equal(Enumerable.Range(21, 50).Select(i => $"m{i}"), second.Messages.Select(m => m.Text));

        var last = await caio.Connection.InvokeAsync<ChatHistoryDto>("GetChatHistory", (long?)second.Messages[0].Id);
        Assert.False(last.HasMore);
        Assert.Equal(Enumerable.Range(1, 20).Select(i => $"m{i}"), last.Messages.Select(m => m.Text));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   \n  ")]
    [InlineData("sino\u0007")]
    public async Task Invalid_messages_are_rejected(string text)
    {
        var ana = await JoinAsync("Ana");
        await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", text));
    }

    [Fact]
    public async Task Too_long_messages_and_callers_outside_a_room_are_rejected()
    {
        var ana = await JoinAsync("Ana");
        await ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", new string('a', 2000));
        var ex = await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", new string('a', 2001)));
        Assert.Contains("2000", ex.Message);

        var lone = await ConnectAsync();
        await Assert.ThrowsAsync<HubException>(() => lone.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "oi"));
        await Assert.ThrowsAsync<HubException>(() => lone.Connection.InvokeAsync<ChatHistoryDto>("GetChatHistory", (long?)null));
    }

    [Fact]
    public async Task Sending_is_rate_limited_per_connection()
    {
        var ana = await JoinAsync("Ana");
        var bia = await JoinAsync("Bia");
        for (var i = 0; i < 5; i++)
        {
            await ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", $"rápida {i}");
        }

        var ex = await Assert.ThrowsAsync<HubException>(() => ana.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "sexta"));
        Assert.Contains("rápido demais", ex.Message);

        // O limite é por conexão: a Bia continua podendo enviar.
        await bia.Connection.InvokeAsync<ChatMessageDto>("SendChatMessage", "oi");
    }

    [Fact]
    public async Task Typing_goes_to_the_others_and_is_throttled()
    {
        var ana = await JoinAsync("Ana");
        var bia = await JoinAsync("Bia");
        var caio = await JoinAsync("Caio");

        await bia.Connection.InvokeAsync("Typing");
        await bia.Connection.InvokeAsync("Typing"); // logo em seguida: ignorado
        await caio.Connection.InvokeAsync("Typing");

        Assert.Equal([bia.Id], await ana.NextAsync("UserTyping"));
        Assert.Equal([caio.Id], await ana.NextAsync("UserTyping")); // o 2º da Bia não chegou
        Assert.Equal([caio.Id], await bia.NextAsync("UserTyping")); // a Bia não recebe o próprio
    }

    private async Task<HubTestClient> JoinAsync(string name)
    {
        var client = await ConnectAsync(name);
        await client.JoinAsync(_room);
        return client;
    }

    private async Task<HubTestClient> ConnectAsync(string? name = null)
    {
        var client = await HubTestClient.ConnectAsync(factory, name);
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
