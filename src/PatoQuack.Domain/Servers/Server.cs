using PatoQuack.Domain.Common;

namespace PatoQuack.Domain.Servers;

/// <summary>Um servidor: agrupa canais de voz. Tem um dono; quem aceita um convite vira membro.</summary>
public sealed class Server
{
    // Usado pelo EF Core para materializar a entidade.
    private Server()
    {
        Name = string.Empty;
    }

    public Server(Guid id, string name, Guid ownerId, DateTimeOffset createdAt)
    {
        Name = DisplayName.Normalize(name) ?? throw new ArgumentException("Nome de servidor inválido.", nameof(name));
        Id = id;
        OwnerId = ownerId;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; }

    /// <summary>Usuário que criou o servidor. Tem todas as permissões nele.</summary>
    public Guid OwnerId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public bool IsOwner(Guid userId) => OwnerId == userId;

    public void Rename(string name) =>
        Name = DisplayName.Normalize(name) ?? throw new ArgumentException("Nome de servidor inválido.", nameof(name));
}
