using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace PatoQuack.Server.Chat;

/// <summary>
/// Limita mensagens por conexão (janela deslizante) e o aviso de "digitando". Em memória: vale
/// para uma instância do servidor, como o resto do estado das salas.
/// </summary>
public sealed class ChatRateLimiter(IOptions<ChatOptions> options, TimeProvider time)
{
    private static readonly TimeSpan TypingInterval = TimeSpan.FromSeconds(2);

    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _messages = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _typing = new();

    /// <summary>Registra uma mensagem se couber na janela; false = rápido demais.</summary>
    public bool TryAcquireMessage(string connectionId)
    {
        var window = TimeSpan.FromSeconds(options.Value.RateLimitWindowSeconds);
        var now = time.GetUtcNow();
        var sent = _messages.GetOrAdd(connectionId, _ => new Queue<DateTimeOffset>());
        lock (sent)
        {
            while (sent.Count > 0 && now - sent.Peek() >= window)
            {
                sent.Dequeue();
            }

            if (sent.Count >= options.Value.RateLimitCount)
            {
                return false;
            }

            sent.Enqueue(now);
            return true;
        }
    }

    /// <summary>"Digitando" no máximo a cada 2 s por conexão; false = ignorar este aviso.</summary>
    public bool TryAcquireTyping(string connectionId)
    {
        var now = time.GetUtcNow();
        var allowed = false;
        _typing.AddOrUpdate(
            connectionId,
            _ => { allowed = true; return now; },
            (_, last) =>
            {
                if (now - last < TypingInterval) return last;
                allowed = true;
                return now;
            });
        return allowed;
    }

    /// <summary>Esquece a conexão (saiu ou caiu).</summary>
    public void Forget(string connectionId)
    {
        _messages.TryRemove(connectionId, out _);
        _typing.TryRemove(connectionId, out _);
    }
}
