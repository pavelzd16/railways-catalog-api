import { PartialType } from '@nestjs/mapped-types';
import { CreateNormDocumentDto } from './create-norm-document.dto';

export class UpdateNormDocumentDto extends PartialType(CreateNormDocumentDto) {}
