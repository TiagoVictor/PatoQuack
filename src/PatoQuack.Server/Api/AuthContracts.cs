namespace PatoQuack.Server.Api;

public sealed record RegisterRequest(string? Name, string? Email, string? Username, string? Password);

/// <summary><c>Login</c> aceita e-mail ou nome de usuário.</summary>
public sealed record LoginRequest(string? Login, string? Password);

public sealed record UserDto(Guid Id, string Name, string Email, string Username);
