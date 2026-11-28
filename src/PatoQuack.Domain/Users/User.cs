using PatoQuack.Domain.Common;

namespace PatoQuack.Domain.Users;

/// <summary>Conta de usuário. Nome é o exibido; usuário (@handle) e e-mail são únicos e servem para entrar.</summary>
public sealed class User
{
    // Usado pelo EF Core para materializar a entidade.
    private User()
    {
        Name = string.Empty;
        Email = string.Empty;
        Username = string.Empty;
        PasswordHash = string.Empty;
    }

    public User(Guid id, string name, string email, string username, string passwordHash, DateTimeOffset createdAt)
    {
        Name = DisplayName.Normalize(name) ?? throw new ArgumentException("Nome inválido.", nameof(name));
        Email = EmailAddress.Normalize(email) ?? throw new ArgumentException("E-mail inválido.", nameof(email));
        Username = Users.Username.Normalize(username) ?? throw new ArgumentException("Usuário inválido.", nameof(username));
        ArgumentException.ThrowIfNullOrEmpty(passwordHash);
        Id = id;
        PasswordHash = passwordHash;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    /// <summary>Nome de exibição (aparece na voz e nas listas).</summary>
    public string Name { get; private set; }

    /// <summary>E-mail normalizado (minúsculas).</summary>
    public string Email { get; private set; }

    /// <summary>Nome de usuário único, normalizado (minúsculas).</summary>
    public string Username { get; private set; }

    /// <summary>Hash da senha (formato definido pelo IPasswordHasher da aplicação).</summary>
    public string PasswordHash { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Senhas erradas seguidas desde o último login certo.</summary>
    public int FailedLoginCount { get; private set; }

    /// <summary>Até quando o login está bloqueado (por senhas erradas demais), ou null.</summary>
    public DateTimeOffset? LockoutEndsAt { get; private set; }

    public bool IsLockedOut(DateTimeOffset now) => LockoutEndsAt is { } end && end > now;

    /// <summary>Conta uma senha errada; ao chegar em <paramref name="maxAttempts"/>, bloqueia por <paramref name="lockout"/>.</summary>
    public void RegisterFailedLogin(DateTimeOffset now, int maxAttempts, TimeSpan lockout)
    {
        FailedLoginCount++;
        if (FailedLoginCount >= maxAttempts)
        {
            LockoutEndsAt = now.Add(lockout);
            FailedLoginCount = 0;
        }
    }

    public void ResetFailedLogins()
    {
        FailedLoginCount = 0;
        LockoutEndsAt = null;
    }

    /// <summary>Troca o hash (ex.: rehash com parâmetros mais fortes após um login).</summary>
    public void UpdatePasswordHash(string passwordHash)
    {
        ArgumentException.ThrowIfNullOrEmpty(passwordHash);
        PasswordHash = passwordHash;
    }
}
