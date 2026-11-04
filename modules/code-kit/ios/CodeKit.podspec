Pod::Spec.new do |s|
  s.name           = 'CodeKit'
  s.version        = '1.0.0'
  s.summary        = 'Still-image barcode decoding with Vision (SPEC §6.2, D13)'
  s.description    = 'detectBarcodes(uri): VNDetectBarcodesRequest over an image file, every symbology.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreImage', 'ImageIO'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
