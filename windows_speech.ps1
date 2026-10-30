param(
  [Parameter(Mandatory = $true)][ValidateSet("voices", "recognize", "speak")][string]$Operation,
  [string]$Text = "",
  [string]$VoiceId = "",
  [ValidateRange(0.5, 2.0)][double]$Rate = 0.9
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech

switch ($Operation) {
  "voices" {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voices = @($synth.GetInstalledVoices() | ForEach-Object {
      [pscustomobject]@{
        id = $_.VoiceInfo.Name
        name = $_.VoiceInfo.Name
        lang = $_.VoiceInfo.Culture.Name
      }
    })
    ConvertTo-Json -InputObject $voices -Compress
    $synth.Dispose()
    break
  }
  "recognize" {
    $culture = [Globalization.CultureInfo]::GetCultureInfo("en-US")
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(15)
    $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(5)
    $recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)
    $recognizer.SetInputToDefaultAudioDevice()
    [Console]::Out.WriteLine("__NOVA_LISTENING__")
    [Console]::Out.Flush()
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(25))
    if ($null -ne $result -and -not [string]::IsNullOrWhiteSpace($result.Text)) {
      $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result.Text))
      [Console]::Out.WriteLine("__NOVA_RESULT__" + $encoded)
    } else {
      [Console]::Out.WriteLine("__NOVA_EMPTY__")
    }
    $recognizer.Dispose()
    break
  }
  "speak" {
    if ([string]::IsNullOrWhiteSpace($Text)) { throw "Speech text cannot be empty." }
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $installed = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
    if ($VoiceId -and $installed -contains $VoiceId) {
      $synth.SelectVoice($VoiceId)
    } else {
      $preferred = $installed | Where-Object { $_ -match '(?i)david|mark|james|guy' } | Select-Object -First 1
      if ($preferred) { $synth.SelectVoice($preferred) }
    }
    $synth.Rate = [Math]::Max(-10, [Math]::Min(10, [int][Math]::Round(($Rate - 1) * 10)))
    $synth.Speak($Text)
    $synth.Dispose()
    break
  }
}
