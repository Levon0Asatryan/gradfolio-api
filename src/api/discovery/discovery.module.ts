import { Module } from '@nestjs/common';
import { BrowseProjectsController, BrowseUsersController } from './browse.controller.js';
import { SearchController } from './search.controller.js';
import { BrowseService } from './services/browse.service.js';
import { CardsService } from './services/cards.service.js';
import { SearchService } from './services/search.service.js';
import { TagService } from './services/tag.service.js';
import { TagsController } from './tags.controller.js';

/** Search, tag pages, browse and the tag cloud. Public, viewer-independent reads. */
@Module({
  controllers: [SearchController, TagsController, BrowseProjectsController, BrowseUsersController],
  providers: [CardsService, SearchService, TagService, BrowseService],
})
export class DiscoveryModule {}
