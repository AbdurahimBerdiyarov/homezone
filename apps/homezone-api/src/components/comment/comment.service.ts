import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import mongoose from 'mongoose';
import { MemberService } from '../member/member.service';
import { PropertyService } from '../property/property.service';
import { BoardArticle } from '../../libs/dto/board-article/board-article';
import { BoardArticleService } from '../board-article/board-article.service';
import { CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { Comment, Comments } from '../../libs/dto/comment/comment';
import { throwError } from 'rxjs';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { T } from '../../libs/types/common';
import { lookupMember } from '../../libs/config';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class CommentService {
	constructor(
		@InjectModel('Comment') private readonly commentModel: Model<Comment>,
		private readonly memberService: MemberService,
		private readonly propertyService: PropertyService,
		private readonly boardArticleService: BoardArticleService,
		private readonly notificationService: NotificationService,
	) {}

	public async createComment(memberId: ObjectId, input: CommentInput): Promise<Comment> {
		input.memberId = memberId;
		let result = null;

		try {
			result = await this.commentModel.create(input);
		} catch (err) {
			console.log('Error, Service.model:', err.message);
			throw new BadRequestException(Message.CREATE_FAILED);
		}

		switch (input.commentGroup) {
			case CommentGroup.PROPERTY:
				await this.propertyService.propertyStatsEditor({
					_id: input.commentRefId,
					targetKey: 'propertyComments',
					modifier: 1,
				});
				break;
			case CommentGroup.ARTICLE:
				await this.boardArticleService.boardArticlesStatusEditor({
					_id: input.commentRefId,
					targetKey: 'articleComments',
					modifier: 1,
				});
				break;
			case CommentGroup.MEMBER:
				await this.memberService.memberStatsEditor({
					_id: input.commentRefId,
					targetKey: 'memberComments',
					modifier: 1,
				});
				break;
		}
		if (!result) throw new InternalServerErrorException(Message.CREATE_FAILED);

		await this.notificationService.createNotificationForComment(
			input.commentGroup,
			input.commentRefId,
			memberId,
			input.commentContent,
		);

		return result;
	}

	public async updateComment(memberId: ObjectId, input: CommentUpdate): Promise<Comment> {
		const { _id } = input;

		const result = await this.commentModel
			.findOneAndUpdate(
				{
					_id: _id,
					memberId: memberId,
					commentStatus: CommentStatus.ACTIVE,
				},
				input,
				{
					new: true,
				},
			)
			.exec();

		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		return result;
	}
	// public async getComments(memberId: ObjectId, input: CommentsInquiry): Promise<Comments> {
	// 	const { commentRefId } = input.search;
	// 	// const match = { commentRefId: new ObjectId(commentRefId) };

	// 	const match = { commentRefId: commentRefId };
	// 	const sort: Record<string, 1 | -1> = { [input?.sort ?? 'createdAt']: input?.direction === -1 ? -1 : 1 };

	// 	console.log('match:::', match);
	// 	console.log('sort:::', sort);
	// 	console.log('commentRefId:::', commentRefId);

	// 	try {
	// 		const result = await this.commentModel.aggregate([
	// 			{ $match: match },
	// 			{ $sort: sort },
	// 			{
	// 				$facet: {
	// 					list: [
	// 						{ $skip: (input.page - 1) * input.limit },
	// 						{ $limit: input.limit },
	// 						lookupMember,
	// 						{ $unwind: '$memberData' },
	// 					],
	// 					metaCounter: [{ $count: 'total' }],
	// 				},
	// 			},
	// 		]);

	// 		console.log('Aggregation result:::', result);

	// 		if (!result.length || !result[0].list.length) {
	// 			throw new InternalServerErrorException('No data found');
	// 		}

	// 		return {
	// 			list: result[0].list,
	// 			metaCounter: result[0].metaCounter.length ? result[0].metaCounter[0].total : 0,
	// 		};
	// 	} catch (error) {
	// 		console.error('Error fetching comments:', error);
	// 		throw new InternalServerErrorException('Error fetching comments');
	// 	}
	// }

	public async getComments(memberId: ObjectId, input: CommentsInquiry): Promise<Comments> {
		const { commentRefId } = input.search;
		const match: T = { commentRefId: commentRefId, commentStatus: CommentStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };
		console.log('match:::', match);
		console.log('sort:::', sort);
		console.log('commentRefId:::', commentRefId);

		const result: Comments[] = await this.commentModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							// meLiked
							lookupMember,
							{ $unwind: '$memberData' },
						],

						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async removeCommentByAdmin(input: ObjectId): Promise<Comment> {
		const result = await this.commentModel.findByIdAndDelete(input).exec();
		if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);
		return result;
	}
}
