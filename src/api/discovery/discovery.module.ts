import { Module } from '@nestjs/common';
import { SearchController } from './search.controller.js';
import { CardsService } from './services/cards.service.js';
import { SearchService } from './services/search.service.js';
import { TagService } from './services/tag.service.js';
import { TagsController } from './tags.controller.js';

/** Search, tag pages and (M6 PR b) browse and the tag cloud. Public, viewer-independent reads. */
@Module({
  controllers: [SearchController, TagsController],
  providers: [CardsService, SearchService, TagService],
})
export class DiscoveryModule {}
