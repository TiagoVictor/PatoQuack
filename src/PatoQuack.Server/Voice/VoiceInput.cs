using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;

namespace PatoQuack.Server.Voice;

/// <summary>Validação e normalização das entradas que chegam pelo hub.</summary>
public static partial class VoiceInput
{
    public const int MaxNameLength = 32;
    public const int MaxRoomLength = 32;
    public const int MaxSdpLength = 16 * 1024;
    public const int MaxCandidateLength = 1024;

    [GeneratedRegex("^[a-z0-9_-]+$")]
    private static partial Regex RoomPattern();

    /// <summary>Sala: letras, números, "-" e "_". Comparada sem diferenciar maiúsculas.</summary>
    public static string NormalizeRoom(string? room)
    {
        var value = (room ?? string.Empty).Trim().ToLowerInvariant();
        if (value.Length is 0 or > MaxRoomLength || !RoomPattern().IsMatch(value))
        {
            throw new HubException($"Sala inválida. Use de 1 a {MaxRoomLength} caracteres: letras, números, '-' ou '_'.");
        }

        return value;
    }

    public static string NormalizeName(string? name)
    {
        var value = (name ?? string.Empty).Trim();
        if (value.Length is 0 or > MaxNameLength || value.Any(char.IsControl))
        {
            throw new HubException($"Nome inválido. Use de 1 a {MaxNameLength} caracteres.");
        }

        return value;
    }

    public static void ValidateDescription(SessionDescriptionDto? description, string expectedType)
    {
        if (description is null
            || !string.Equals(description.Type, expectedType, StringComparison.Ordinal)
            || string.IsNullOrEmpty(description.Sdp)
            || description.Sdp.Length > MaxSdpLength)
        {
            throw new HubException($"Descrição de sessão ({expectedType}) inválida.");
        }
    }

    public static void ValidateCandidate(IceCandidateDto? candidate)
    {
        if (candidate is null || (candidate.Candidate?.Length ?? 0) > MaxCandidateLength)
        {
            throw new HubException("ICE candidate inválido.");
        }
    }
}
