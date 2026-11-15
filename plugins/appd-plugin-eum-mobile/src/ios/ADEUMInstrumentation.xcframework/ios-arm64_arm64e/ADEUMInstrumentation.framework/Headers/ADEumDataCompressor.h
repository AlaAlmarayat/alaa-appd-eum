//
//  ADEumDataCompressor.h
//  ADEUMInstrumentation
//
//  Created by mreddyp2 on 08/12/25.
//  Copyright © 2025 AppDynamics Technologies. All rights reserved.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * @protocol ADEumDataCompressor
 *
 * A protocol that defines a generic data compression interface.
 *
 * Classes adopting this protocol must provide an implementation that takes
 * uncompressed `NSData` input and returns the compressed representation of
 * that data. Implementations may choose any compression algorithm or strategy
 * as appropriate for their use case.
 *
 * If the compression operation cannot be completed (for example, due to
 * invalid input, algorithm failure, or resource limitations), the method
 * should return `nil` to indicate the failure.
 */
@protocol ADEumDataCompressor <NSObject>
/**
 * Compresses the provided data and returns its compressed form.
 *
 * @param data The uncompressed data to be compressed. This value must not be nil.
 *
 * @return An `NSData` object containing the compressed data, or `nil` if
 *         compression fails for any reason.
 */
- (nullable NSData *)compressData:(nonnull NSData *)data;
@end

NS_ASSUME_NONNULL_END
