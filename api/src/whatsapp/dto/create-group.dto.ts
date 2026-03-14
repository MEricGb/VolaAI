export class CreateGroupDto {
  name!: string;
  ownerPhone?: string;
  ownerName?: string;
  memberPhones!: string[];
}
