namespace PatoQuack.Application.Users;

/// <summary>Porta de hash de senha. A infraestrutura escolhe o algoritmo.</summary>
public interface IPasswordHasher
{
    string Hash(string password);

    /// <summary>Confere a senha contra o hash.</summary>
    PasswordVerification Verify(string hash, string password);
}

public enum PasswordVerification
{
    Failed,
    Success,
    /// <summary>Correta, mas o hash usa parâmetros antigos e deve ser refeito.</summary>
    SuccessRehashNeeded,
}
