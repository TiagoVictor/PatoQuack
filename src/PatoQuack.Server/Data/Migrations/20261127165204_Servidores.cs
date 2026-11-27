using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PatoQuack.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class Servidores : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Mensagens antigas eram por nome de sala (sem servidor/canal): descartadas, como combinado.
            migrationBuilder.Sql("DELETE FROM ChatMessages;");

            migrationBuilder.DropTable(
                name: "SignupInvites");

            migrationBuilder.DropIndex(
                name: "IX_ChatMessages_Room_Id",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "Room",
                table: "ChatMessages");

            migrationBuilder.AddColumn<int>(
                name: "ChannelId",
                table: "ChatMessages",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Servers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    OwnerId = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Servers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Servers_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Channels",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ServerId = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    Position = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Channels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Channels_Servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "Servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServerInvites",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Code = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    ServerId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedById = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ExpiresAt = table.Column<long>(type: "INTEGER", nullable: false),
                    MaxUses = table.Column<int>(type: "INTEGER", nullable: true),
                    Uses = table.Column<int>(type: "INTEGER", nullable: false),
                    RevokedAt = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServerInvites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServerInvites_AspNetUsers_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ServerInvites_Servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "Servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServerMembers",
                columns: table => new
                {
                    ServerId = table.Column<int>(type: "INTEGER", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Role = table.Column<int>(type: "INTEGER", nullable: false),
                    JoinedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServerMembers", x => new { x.ServerId, x.UserId });
                    table.ForeignKey(
                        name: "FK_ServerMembers_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ServerMembers_Servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "Servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_ChannelId_Id",
                table: "ChatMessages",
                columns: new[] { "ChannelId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Channels_ServerId",
                table: "Channels",
                column: "ServerId");

            migrationBuilder.CreateIndex(
                name: "IX_ServerInvites_Code",
                table: "ServerInvites",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ServerInvites_CreatedById",
                table: "ServerInvites",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_ServerInvites_ServerId",
                table: "ServerInvites",
                column: "ServerId");

            migrationBuilder.CreateIndex(
                name: "IX_ServerMembers_UserId",
                table: "ServerMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Servers_OwnerId",
                table: "Servers",
                column: "OwnerId");

            migrationBuilder.AddForeignKey(
                name: "FK_ChatMessages_Channels_ChannelId",
                table: "ChatMessages",
                column: "ChannelId",
                principalTable: "Channels",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ChatMessages_Channels_ChannelId",
                table: "ChatMessages");

            migrationBuilder.DropTable(
                name: "Channels");

            migrationBuilder.DropTable(
                name: "ServerInvites");

            migrationBuilder.DropTable(
                name: "ServerMembers");

            migrationBuilder.DropTable(
                name: "Servers");

            migrationBuilder.DropIndex(
                name: "IX_ChatMessages_ChannelId_Id",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "ChannelId",
                table: "ChatMessages");

            migrationBuilder.AddColumn<string>(
                name: "Room",
                table: "ChatMessages",
                type: "TEXT",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "SignupInvites",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CreatedById = table.Column<string>(type: "TEXT", nullable: false),
                    Code = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ExpiresAt = table.Column<long>(type: "INTEGER", nullable: false),
                    Room = table.Column<string>(type: "TEXT", maxLength: 32, nullable: true),
                    UsedAt = table.Column<long>(type: "INTEGER", nullable: true),
                    UsedById = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SignupInvites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SignupInvites_AspNetUsers_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_Room_Id",
                table: "ChatMessages",
                columns: new[] { "Room", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SignupInvites_Code",
                table: "SignupInvites",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SignupInvites_CreatedById",
                table: "SignupInvites",
                column: "CreatedById");
        }
    }
}
