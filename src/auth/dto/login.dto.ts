import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(128)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}
