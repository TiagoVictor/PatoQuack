using PatoQuack.Domain.Users;

namespace PatoQuack.Application.Users;

public sealed record RegisterCommand(string? Name, string? Email, string? Username, string? Password);

public enum RegisterStatus
{
    Registered,
    InvalidName,
    InvalidEmail,
    InvalidUsername,
    WeakPassword,
    EmailTaken,
    UsernameTaken,
}

public sealed record RegisterResult(RegisterStatus Status, User? User = null);

public enum LoginStatus
{
    Succeeded,
    /// <summary>Login ou senha errados (sem dizer qual).</summary>
    Invalid,
    /// <summary>Senhas erradas demais: bloqueado por um tempo.</summary>
    LockedOut,
}

public sealed record LoginResult(LoginStatus Status, User? User = null);
