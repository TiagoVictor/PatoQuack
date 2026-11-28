using Microsoft.AspNetCore.SignalR;
using PatoQuack.Domain.Common;

namespace PatoQuack.Server.Voice;

/// <summary>Validação e normalização das entradas que chegam pelo hub.</summary>
public static class VoiceInput
{
    public const int MaxNameLength = DisplayName.MaxLength;
    public const int MaxSdpLength = 16 * 1024;
    public const int MaxCandidateLength = 1024;

    /// <summary>Id do canal (Guid). O canal precisa existir; isso o serviço confere.</summary>
    public static Guid ParseChannelId(string? channelId) =>
        Guid.TryParse(channelId, out var id) ? id : throw new HubException("Canal inválido.");

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
