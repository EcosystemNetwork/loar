/**
 * Character Generation Hook
 *
 * Handles character-based image generation using Nano Banana AI.
 * Supports both scene generation with characters and character frame editing.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { type StatusMessage } from '@/hooks/useVideoGeneration';

export type ImageFormat =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';

export interface UseCharacterGenerationProps {
  selectedCharacters: string[];
  selectedImageCharacters: string[];
  charactersData: any;
  imageFormat: ImageFormat;
  videoDescription: string;
  setGeneratedImageUrl: (url: string | null) => void;
  setShowVideoStep: (show: boolean) => void;
  setStatusMessage: (message: StatusMessage | null) => void;
}

export interface UseCharacterGenerationReturn {
  isGeneratingImage: boolean;
  generateImageMutation: any;
  handleGenerateEventImage: () => Promise<void>;
  handleGenerateCharacterFrame: () => Promise<void>;
}

export function useCharacterGeneration({
  selectedCharacters,
  selectedImageCharacters,
  charactersData,
  imageFormat,
  videoDescription,
  setGeneratedImageUrl,
  setShowVideoStep,
  setStatusMessage,
}: UseCharacterGenerationProps): UseCharacterGenerationReturn {
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Image generation mutation using Nano Banana for editing
  const generateImageMutation = useMutation({
    mutationFn: async (prompt: string) => {
      // Check if we have selected characters to edit into the scene
      if (selectedCharacters.length > 0 && charactersData?.characters) {
        const selectedChars = charactersData.characters.filter((c: any) =>
          selectedCharacters.includes(c.id)
        );

        if (selectedChars.length > 0) {
          // Process all selected character images
          const characterNames = selectedChars.map((c: any) => c.character_name).join(' and ');

          // Create edit prompt that places characters in the scene
          const editPrompt = `${characterNames} ${prompt}, cinematic scene, high quality, detailed environment`;

          // Use character image URLs directly
          const processedImageUrls = selectedChars
            .filter((char: any) => char.image_url && char.image_url.trim())
            .map((char: any) => char.image_url);

          // Validate we have at least one valid image URL
          if (processedImageUrls.length === 0) {
            throw new Error('No valid character images found for editing');
          }

          try {
            const result = await trpcClient.image.imageToImage.mutate({
              prompt: `Create a cinematic frame: ${editPrompt}. Professional photography, detailed environment, high quality composition`,
              imageUrls: processedImageUrls,
              imageSize: imageFormat,
              numImages: 1,
            });

            if (result.status !== 'completed' || !result.imageUrl) {
              throw new Error(result.error || 'Nano Banana frame generation failed');
            }

            return { success: true, imageUrl: result.imageUrl };
          } catch (imageToImageError) {
            const errorMessage =
              imageToImageError instanceof Error
                ? imageToImageError.message
                : 'Nano Banana edit failed';

            throw new Error(
              `Frame generation failed: ${errorMessage}. Please check character images and try again.`
            );
          }
        }
      }

      // For scenes without characters, generate directly with Nano Banana
      try {
        const result = await trpcClient.image.generateImage.mutate({
          prompt: `${prompt}, cinematic scene, high quality, detailed environment, professional photography, dramatic lighting`,
          model: 'fal-ai/nano-banana',
          imageSize: imageFormat,
          numImages: 1,
        });

        if (result.status !== 'completed' || !result.imageUrl) {
          throw new Error(result.error || 'Failed to generate scene image');
        }

        return { success: true, imageUrl: result.imageUrl };
      } catch (error) {
        throw error;
      }
    },
    onSuccess: (data) => {
      if (data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
        setShowVideoStep(true);

        setStatusMessage({
          type: 'success',
          title: 'Image Generated Successfully!',
          description:
            'Your scene image has been generated. Now you can create a video animation from it.',
        });
      }
    },
    onError: (error) => {
      let errorTitle = 'Image Generation Failed';
      let errorMessage = 'Failed to generate image. ';
      if (selectedCharacters.length > 0) {
        errorMessage += 'Character image editing failed. ';
      }
      errorMessage += 'Please try again.';

      if (error.message?.includes('FAL_KEY')) {
        errorTitle = 'API Configuration Error';
        errorMessage = 'FAL API key is missing. Please configure FAL_KEY in environment variables.';
      } else if (error.message?.includes('nano-banana')) {
        errorTitle = 'Nano Banana API Error';
        errorMessage =
          'The Nano Banana image generation service encountered an error. Please try again.';
      }

      setStatusMessage({
        type: 'error',
        title: errorTitle,
        description: errorMessage,
      });
    },
  });

  // Handle image generation for the event
  const handleGenerateEventImage = useCallback(async () => {
    if (!videoDescription.trim()) return;

    setStatusMessage(null); // Clear any previous messages
    setIsGeneratingImage(true);
    try {
      // Use the video description as the image prompt
      await generateImageMutation.mutateAsync(videoDescription);
    } catch (error) {
      // Error handled by UI state
    } finally {
      setIsGeneratingImage(false);
    }
  }, [videoDescription, generateImageMutation, setStatusMessage]);

  // Handle character frame generation for image-to-video
  const handleGenerateCharacterFrame = useCallback(async () => {
    if (!videoDescription.trim() || selectedImageCharacters.length === 0) return;

    setStatusMessage(null);
    setIsGeneratingImage(true);

    try {
      // Get selected character data
      const selectedChars =
        charactersData?.characters?.filter((c: any) => selectedImageCharacters.includes(c.id)) ||
        [];

      if (selectedChars.length === 0) {
        setStatusMessage({
          type: 'error',
          title: 'No Characters Found',
          description: 'Please select valid characters.',
        });
        return;
      }

      const characterNames = selectedChars.map((c: any) => c.character_name).join(' and ');

      // Get character image URLs for nano-banana edit
      const characterImageUrls = selectedChars
        .filter((char: any) => char.image_url && char.image_url.trim())
        .map((char: any) => char.image_url);

      if (characterImageUrls.length === 0) {
        setStatusMessage({
          type: 'error',
          title: 'No Character Images',
          description: 'Selected characters have no valid images.',
        });
        return;
      }

      setStatusMessage({
        type: 'info',
        title: 'Generating Character Frame',
        description: 'Creating frame with nano-banana...',
      });

      // Call nano-banana edit directly with the character images
      const editPrompt = `${characterNames} ${videoDescription}, cinematic scene, high quality, detailed environment`;

      const result = await trpcClient.image.imageToImage.mutate({
        prompt: `Create a cinematic frame: ${editPrompt}. Professional photography, detailed environment, high quality composition`,
        imageUrls: characterImageUrls,
        imageSize: imageFormat,
        numImages: 1,
      });

      if (result.status !== 'completed' || !result.imageUrl) {
        throw new Error(result.error || 'Character frame generation failed');
      }

      setGeneratedImageUrl(result.imageUrl);

      setStatusMessage({
        type: 'success',
        title: 'Frame Generated!',
        description: 'Your character frame is ready. Now you can generate a video from it.',
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        title: 'Frame Generation Failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to generate character frame. Please try again.',
      });
    } finally {
      setIsGeneratingImage(false);
    }
  }, [
    videoDescription,
    selectedImageCharacters,
    charactersData,
    imageFormat,
    setGeneratedImageUrl,
    setStatusMessage,
  ]);

  return {
    isGeneratingImage,
    generateImageMutation,
    handleGenerateEventImage,
    handleGenerateCharacterFrame,
  };
}
