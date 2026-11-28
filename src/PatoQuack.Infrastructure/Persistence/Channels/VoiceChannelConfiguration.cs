using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Infrastructure.Persistence.Channels;

internal sealed class VoiceChannelConfiguration : IEntityTypeConfiguration<VoiceChannel>
{
    public const string Table = "voice_channels";

    public static class Columns
    {
        public const string Id = "id";
        public const string ServerId = "server_id";
        public const string Name = "name";
        public const string StreamerConnectionId = "streamer_connection_id";
        public const string CreatedAt = "created_at";
    }

    public void Configure(EntityTypeBuilder<VoiceChannel> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(c => c.Id);

        builder.Property(c => c.Id)
            .HasColumnName(Columns.Id)
            .ValueGeneratedNever();

        builder.Property(c => c.ServerId)
            .HasColumnName(Columns.ServerId)
            .IsRequired();

        builder.Property(c => c.Name)
            .HasColumnName(Columns.Name)
            .HasMaxLength(DisplayName.MaxLength)
            .IsRequired();

        builder.Property(c => c.StreamerConnectionId)
            .HasColumnName(Columns.StreamerConnectionId)
            .HasMaxLength(Participant.MaxConnectionIdLength);

        builder.Property(c => c.CreatedAt)
            .HasColumnName(Columns.CreatedAt)
            .IsRequired();

        builder.Ignore(c => c.HasStreamer);

        // Nome único por servidor (o serviço também compara sem diferenciar maiúsculas).
        builder.HasIndex(c => new { c.ServerId, c.Name }).IsUnique();

        // Apagar o servidor apaga os canais.
        builder.HasOne<Server>()
            .WithMany()
            .HasForeignKey(c => c.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
